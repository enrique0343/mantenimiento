# Sistema de Gestión de Mantenimiento — Astro + Cloudflare

Stack: **Astro SSR** · **Cloudflare Pages** · **D1 (SQLite)** · **R2 (storage)** · **Drizzle ORM** · **Tailwind CSS** · **JWT (Web Crypto)**

---

## Estructura del proyecto

```
app/
├── src/
│   ├── lib/
│   │   ├── schema.ts      ← Drizzle schema (17 tablas)
│   │   ├── db.ts          ← getDb(d1), newId(), newToken()
│   │   ├── auth.ts        ← JWT HS256 + PBKDF2 (Web Crypto)
│   │   └── utils.ts       ← json(), slaDueDate(), etc.
│   ├── middleware.ts       ← Auth JWT en cada request
│   ├── layouts/
│   │   └── Layout.astro   ← Layout con sidebar responsivo
│   ├── pages/
│   │   ├── login.astro          → login público
│   │   ├── setup.astro          → primer administrador
│   │   ├── dashboard.astro      → KPIs
│   │   ├── equipos/             → CRUD equipos + QR
│   │   ├── ordenes/             → CRUD OTs + cierre
│   │   ├── planes/              → Planes preventivos
│   │   ├── predictivo/          → Mediciones + alertas
│   │   ├── helpdesk/
│   │   │   ├── index.astro      → lista interna
│   │   │   ├── [id].astro       → detalle interno
│   │   │   ├── nuevo.astro      → formulario público (sin auth)
│   │   │   └── ticket/[token].astro → seguimiento público
│   │   ├── inventario/          → Repuestos + alertas stock
│   │   ├── proveedores/         → CRUD proveedores
│   │   ├── usuarios/            → CRUD usuarios
│   │   └── configuracion/       → Sucursales + info deploy
│   └── pages/api/
│       ├── auth/          login · register-admin · logout
│       ├── equipment/     CRUD + historial
│       ├── work-orders/   CRUD + cierre
│       ├── helpdesk/      tickets + seguimiento público
│       ├── spare-parts/   inventario + alertas stock
│       ├── measurements/  predictivo
│       ├── maintenance-plans/
│       ├── branches/
│       ├── users/
│       ├── providers/
│       ├── kpis/          dashboard KPIs
│       └── r2/            upload + serve archivos R2
├── drizzle/
│   └── 0000_safe_lady_ursula.sql  ← migración inicial (17 tablas)
├── wrangler.toml
└── drizzle.config.ts
```

---

## Deploy en Cloudflare Pages — paso a paso

### 1. Instalar wrangler

```bash
npm install -g wrangler
wrangler login
```

### 2. Crear la base de datos D1

```bash
wrangler d1 create mantenimiento-db
```

Copia el `database_id` que aparece y reemplázalo en `wrangler.toml`:

```toml
[[d1_databases]]
database_id = "PEGA_AQUI_EL_DATABASE_ID"
```

### 3. Crear el bucket R2

```bash
wrangler r2 bucket create mantenimiento-files
```

### 4. Aplicar migraciones remotas

```bash
npm run db:migrate:remote
```

### 5. Variables de entorno (dashboard de Pages → Settings → Environment variables)

| Variable | Descripción |
|---|---|
| `JWT_SECRET` | cadena aleatoria ≥32 caracteres |
| `BASE_URL` | `https://tu-proyecto.pages.dev` |
| `SMTP_HOST` | servidor SMTP (ej. smtp.gmail.com) |
| `SMTP_PORT` | 587 |
| `SMTP_USER` | usuario SMTP |
| `SMTP_PASS` | contraseña SMTP |
| `SMTP_FROM_NAME` | nombre del remitente |

### 6. Vincular bindings en Pages (dashboard → Settings → Functions)

- **D1 binding** → nombre `DB` → base de datos `mantenimiento-db`
- **R2 binding** → nombre `R2` → bucket `mantenimiento-files`

### 7. Deploy

```bash
npm run deploy
# equivale a: astro build && wrangler pages deploy ./dist
```

---

## Desarrollo local

```bash
npm install
npm run db:migrate:local   # aplica migraciones en SQLite local
npm run dev                # http://localhost:4321
```

El primer acceso redirige a `/setup` para crear el administrador.

---

## Comandos útiles

| Comando | Acción |
|---|---|
| `npm run dev` | Servidor de desarrollo (localhost:4321) |
| `npm run build` | Build de producción en `./dist` |
| `npm run deploy` | Build + deploy a Cloudflare Pages |
| `npm run db:generate` | Genera nueva migración SQL tras cambiar schema.ts |
| `npm run db:migrate:local` | Aplica migraciones en D1 local |
| `npm run db:migrate:remote` | Aplica migraciones en D1 remoto (producción) |

---

## Seguridad

- Contraseñas: PBKDF2 SHA-256, 100.000 iteraciones, salt aleatorio 16 bytes
- JWT: HS256, cookie `HttpOnly; SameSite=Lax`, expiración 8h
- `register-admin` solo funciona cuando no existe ningún usuario
- Archivos R2 servidos autenticados vía `/api/r2/upload?key=...`
- Formulario público de helpdesk aislado — sin acceso a datos internos
