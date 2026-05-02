# Mantenimiento — CMMS en Cloudflare

Sistema de gestión de mantenimiento (CMMS) desplegado **íntegramente en Cloudflare**:

- **Pages** (frontend Astro + React + Tailwind, SSR)
- **Workers** (API server-side dentro del mismo deploy)
- **D1** (base de datos SQLite serverless)
- **R2** (almacenamiento de adjuntos)
- **Drizzle ORM** + migraciones
- Auth con JWT (cookies httpOnly) y PBKDF2 (Web Crypto, sin dependencias nativas)

## Funcionalidades

- Login / logout, sesiones de 7 días
- Roles: `admin`, `tecnico`, `solicitante`
- Bootstrap automático: el primer registro crea el admin
- **Activos / equipos**: alta, listado, estado (operativo, averiado, mantenimiento, baja)
- **Órdenes de trabajo**: tipo (preventivo / correctivo), prioridad, estado, asignación, vencimiento
- **Comentarios** y **adjuntos** (R2) por orden
- Dashboard con métricas (abiertas, en proceso, completadas, vencidas)
- Gestión de usuarios (solo admin)

## Estructura

```
src/
  middleware.ts            # auth gate
  lib/
    schema.ts              # tablas Drizzle
    db.ts                  # cliente D1
    auth.ts                # JWT + PBKDF2 + cookies
  pages/
    index.astro            # dashboard
    login.astro
    activos/
    ordenes/
    usuarios.astro
    api/
      auth/                # login, logout, me, needs-bootstrap
      activos/
      ordenes/[id]/...     # detalle, comentarios, adjuntos
      adjuntos/[id].ts     # descarga R2
      usuarios/
      dashboard.ts
migrations/
  0000_init.sql
  seed.sql
```

## Setup local

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar `.dev.vars`

```bash
cp .dev.vars.example .dev.vars
# edita y pon un JWT_SECRET largo y aleatorio:
# JWT_SECRET=$(openssl rand -base64 48)
```

### 3. Crear la D1 (local)

```bash
npx wrangler d1 migrations apply mantenimiento-db --local
npx wrangler d1 execute mantenimiento-db --local --file=./migrations/seed.sql
```

### 4. Levantar dev server

```bash
npm run dev
```

Abre http://localhost:4321 — al ser el primer arranque, el formulario de login te pedirá nombre + email + password y creará automáticamente el admin.

## Despliegue a Cloudflare

### 1. Login y crear recursos

```bash
npx wrangler login

# Crear D1
npx wrangler d1 create mantenimiento-db
# => copia el database_id devuelto y reemplázalo en wrangler.toml

# Crear bucket R2
npx wrangler r2 bucket create mantenimiento-adjuntos
```

### 2. Aplicar migraciones en producción

```bash
npx wrangler d1 migrations apply mantenimiento-db --remote
# (opcional) datos de ejemplo:
npx wrangler d1 execute mantenimiento-db --remote --file=./migrations/seed.sql
```

### 3. Configurar secret JWT

```bash
npx wrangler pages secret put JWT_SECRET --project-name=mantenimiento
# pega un valor generado con: openssl rand -base64 48
```

### 4. Deploy

```bash
npm run deploy
```

Obtendrás una URL `https://mantenimiento.pages.dev`. La primera vez que entres, crea el admin desde el formulario de login.

### 5. Conectar bindings al proyecto Pages

En el dashboard de Cloudflare → Pages → `mantenimiento` → **Settings → Functions → Bindings**, agrega:

- **D1 database**: variable `DB` → base `mantenimiento-db`
- **R2 bucket**: variable `R2` → bucket `mantenimiento-adjuntos`

(Alternativamente puedes hacerlo con `wrangler pages deployment` y `--binding`, pero la UI es más simple para la primera vez.)

Vuelve a desplegar (`npm run deploy`) para que los bindings tomen efecto.

## Comandos útiles

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Astro dev (con D1 y R2 simulados vía `platformProxy`) |
| `npm run build` | Build producción |
| `npm run deploy` | Build + deploy a Pages |
| `npm run db:generate` | Generar migraciones desde el schema |
| `npm run db:migrate:local` | Aplicar migraciones a D1 local |
| `npm run db:migrate:remote` | Aplicar migraciones a D1 producción |
| `npm run typecheck` | `astro check` |

## Cambiar el schema

1. Edita `src/lib/schema.ts`
2. `npm run db:generate` (genera SQL en `migrations/`)
3. Aplica local y remoto con los comandos `db:migrate:*`

## Roles y permisos

- **admin**: todo (incluye crear usuarios y borrar órdenes/activos)
- **tecnico**: crea/edita activos, gestiona órdenes y adjuntos
- **solicitante**: lee, crea órdenes, comenta

## Fase 1 — Mantenimiento preventivo (instalación)

Esta fase agrega: campos extendidos en equipos (marca, modelo, serial, año, biomédico con DNM/calibración), tabla de **planes de mantenimiento** y un **cron diario** que crea órdenes preventivas automáticamente cuando vence un plan.

### Pasos de instalación

```bash
# 1. Aplicar migración a D1 producción
npx wrangler d1 migrations apply mantenimiento-db --remote

# 2. Generar dos secretos
JWT=$(openssl rand -base64 48)
CRON=$(openssl rand -base64 48)
echo "JWT_SECRET = $JWT"
echo "CRON_SECRET = $CRON"

# 3. Configurar el secret CRON en el sitio Pages
echo "$CRON" | npx wrangler pages secret put CRON_SECRET --project-name=mantenimiento-49c

# 4. Deploy del sitio
npm run deploy

# 5. Setup del cron worker (carpeta cron-worker/)
cd cron-worker
npm install
echo "$CRON" | npx wrangler secret put CRON_SECRET
npx wrangler deploy
cd ..
```

### Probar el cron manualmente

```bash
curl -X POST https://mantenimiento-cron.<tu-subdominio>.workers.dev/run \
  -H "x-cron-secret: <tu CRON_SECRET>"
```

Respuesta esperada: `{ ok: true, fecha: "2026-05-02", creadas: N, detalles: [...] }`.

El cron real corre cada día a las **06:00 hora El Salvador** (12:00 UTC).

### Cómo funciona

1. Creas un equipo desde `/activos/nuevo`. Si es **biomédico** se habilitan los campos DNM, clase de riesgo y calibraciones.
2. En el detalle del equipo (`/activos/[id]`) agregas planes al **cronograma** (frecuencia, próxima fecha, asignado, prioridad).
3. Cada día a las 6am, el cron worker llama al endpoint `/api/cron/generar-preventivos`. Para cada plan con `proxima_fecha <= hoy`:
   - Crea una orden tipo `preventivo` con el título y prioridad del plan
   - La asigna **sin técnico** (rol admin decide quien la toma — opción que elegiste)
   - Avanza `proxima_fecha` al siguiente ciclo según la frecuencia
4. La vista `/cronograma` muestra los planes agrupados por urgencia (vencidos / 7 días / 30 días / futuros).
5. El dashboard tiene un widget con los próximos 14 días.

## Notas técnicas

- El hash de contraseñas usa **PBKDF2-SHA256** con 100k iteraciones (compatible con Workers; bcrypt no funciona ahí).
- Las sesiones son JWT firmado HS256 en cookie `mant_session` (httpOnly, Secure, SameSite=Lax, 7 días).
- El middleware (`src/middleware.ts`) bloquea acceso no autenticado a todo excepto `/login` y `/api/auth/*`.
- Los adjuntos se sirven proxiando R2 a través de `/api/adjuntos/[id]` para mantener el control de acceso (no se exponen URLs públicas).
- Límite de subida: 10 MB por archivo (ajustable en `src/pages/api/ordenes/[id]/adjuntos.ts`).
