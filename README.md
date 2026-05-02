# Sistema de Gestión de Mantenimiento

Aplicación web para gestión de mantenimiento preventivo, correctivo y predictivo de equipos.

## Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript
- **Base de datos**: PostgreSQL + Prisma ORM
- **Almacenamiento**: Supabase Storage (producción) o disco local (desarrollo)

---

## Requisitos previos (Mac)

| Herramienta | Instalación |
|-------------|-------------|
| Node.js 18+ | `brew install node` |
| Docker Desktop | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) |
| Git | Ya viene en Mac (`xcode-select --install` si pide) |

---

## Setup local (primera vez)

### 1. Clonar el repositorio

```bash
git clone <url-del-repo>
cd mantenimiento
```

### 2. Levantar PostgreSQL con Docker

```bash
docker compose up -d
```

Esto levanta PostgreSQL en `localhost:5432`. Los datos persisten aunque apagues Docker.

### 3. Configurar variables de entorno

```bash
cp server/.env.example.local server/.env
cp client/.env.example.local client/.env
```

> Los archivos `.env.local` ya vienen pre-configurados para desarrollo local. No necesitas cambiar nada para empezar.

### 4. Instalar dependencias

```bash
cd server && npm install
cd ../client && npm install
```

### 5. Crear tablas y cargar datos de prueba

```bash
cd server
npx prisma db push    # crea las tablas en la BD
npx prisma db seed    # carga datos iniciales
```

El seed crea:

| Usuario | Email | Contraseña | Rol |
|---------|-------|------------|-----|
| Admin | admin@miempresa.com | admin123 | Administrador |
| Jefe | jefe@miempresa.com | jefe123 | Jefe de Mantenimiento |
| Técnico | tecnico@miempresa.com | tech123 | Técnico |

---

## Arrancar el sistema

Necesitas **dos terminales** abiertas:

**Terminal 1 — Servidor (API)**
```bash
cd server
npm run dev
# Corre en http://localhost:3001
```

**Terminal 2 — Cliente (UI)**
```bash
cd client
npm run dev
# Abre http://localhost:5173 en el navegador
```

---

## Comandos útiles

```bash
# Ver logs de la BD en Docker
docker compose logs postgres

# Detener Docker
docker compose down

# Reiniciar y limpiar la BD (borra todos los datos)
docker compose down -v
docker compose up -d
cd server && npx prisma db push && npx prisma db seed

# Abrir Prisma Studio (explorador visual de la BD)
cd server && npx prisma studio
# Abre http://localhost:5555
```

---

## Storage de archivos en local

Sin Supabase configurado, las imágenes y firmas se guardan automáticamente en:
```
server/uploads/
  ├── images/      ← fotos de OTs (antes/después)
  ├── signatures/  ← firmas digitales
  └── logos/       ← logo de la empresa
```

Y se sirven desde `http://localhost:3001/uploads/...`

---

## Deploy a producción (Cloudflare + VPS)

Ver sección de deploy cuando estés listo. Resumen:

1. `cd client && npm run build` → subir `/dist` a Cloudflare Pages
2. Servidor Node en VPS con PM2 + Nginx
3. Cambiar `.env` para apuntar a PostgreSQL en producción
4. Agregar credenciales de Supabase Storage para imágenes

---

## Estructura del proyecto

```
mantenimiento/
├── client/          # React + Vite (frontend)
├── server/          # Express + Prisma (backend)
│   ├── prisma/      # Schema y seed de la BD
│   ├── src/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/   # email, storage
│   │   └── middleware/
│   └── uploads/     # Archivos locales (git-ignored)
└── docker-compose.yml
```
