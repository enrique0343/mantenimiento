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

## Notas técnicas

- El hash de contraseñas usa **PBKDF2-SHA256** con 100k iteraciones (compatible con Workers; bcrypt no funciona ahí).
- Las sesiones son JWT firmado HS256 en cookie `mant_session` (httpOnly, Secure, SameSite=Lax, 7 días).
- El middleware (`src/middleware.ts`) bloquea acceso no autenticado a todo excepto `/login` y `/api/auth/*`.
- Los adjuntos se sirven proxiando R2 a través de `/api/adjuntos/[id]` para mantener el control de acceso (no se exponen URLs públicas).
- Límite de subida: 10 MB por archivo (ajustable en `src/pages/api/ordenes/[id]/adjuntos.ts`).
