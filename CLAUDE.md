# Sistema de Gestión de Mantenimiento General y Biomédico

## Visión General

Aplicación web full-stack para la gestión integral de mantenimiento **preventivo**, **correctivo** y **predictivo** de equipos generales y biomédicos. Incluye helpdesk, inventario, planificador, KPIs, acceso por QR y firma digital.

---

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| Estado global | Zustand |
| Backend | Node.js + Express (API REST) |
| Base de datos | PostgreSQL + Prisma ORM |
| Autenticación | JWT + bcrypt |
| Almacenamiento | Supabase Storage (imágenes) |
| QR | qrcode + html5-qrcode |
| Firma digital | signature_pad |
| Gráficos/KPIs | Recharts |
| Email/notificaciones | Nodemailer + WebSockets (Socket.io) |

---

## Arquitectura del Proyecto

```
mantenimiento/
├── client/                     # Frontend React
│   ├── src/
│   │   ├── components/         # Componentes reutilizables
│   │   │   ├── ui/             # shadcn/ui base components
│   │   │   ├── qr/             # Escáner y generador QR
│   │   │   ├── signature/      # Componente firma digital
│   │   │   ├── images/         # Upload hasta 4 imágenes (2 antes + 2 después)
│   │   │   └── forms/          # Formularios reutilizables
│   │   ├── pages/              # Vistas principales
│   │   │   ├── Dashboard/      # KPIs y tablero
│   │   │   ├── Equipment/      # Fichas de equipos
│   │   │   ├── Maintenance/    # Preventivo / Correctivo / Predictivo
│   │   │   ├── Helpdesk/       # Tickets de soporte
│   │   │   ├── Planner/        # Planificador con calendario
│   │   │   ├── Inventory/      # Repuestos e insumos
│   │   │   ├── Users/          # Gestión de usuarios
│   │   │   ├── Providers/      # Proveedores externos
│   │   │   └── Reports/        # Reportes y bitácoras
│   │   ├── hooks/              # Custom hooks
│   │   ├── store/              # Zustand stores
│   │   ├── lib/                # Utilidades, API client
│   │   └── types/              # TypeScript interfaces
├── server/                     # Backend Express
│   ├── src/
│   │   ├── routes/             # Rutas de la API
│   │   ├── controllers/        # Lógica de negocio
│   │   ├── middleware/         # Auth, validación, upload
│   │   ├── services/           # Servicios externos (email, storage)
│   │   └── utils/              # Helpers
│   └── prisma/
│       └── schema.prisma       # Modelo de datos
└── shared/                     # Tipos compartidos cliente/servidor
```

---

## Módulos del Sistema

### 1. Gestión de Equipos

Cada equipo tiene una **ficha técnica** completa:

- **Identificación**: Código interno, código QR único, número de serie, modelo, marca, año de fabricación
- **Clasificación**: Tipo de equipo (general / biomédico), categoría, subcategoría
- **Ubicación**: Sede, edificio, piso, área/servicio
- **Activos fijos**: Número de activo, valor de adquisición, fecha de compra, estado (activo/inactivo/dado de baja)
- **Documentación**: Manual, certificados, hojas de vida (bitácora histórica)
- **Estado actual**: Operativo, en mantenimiento, fuera de servicio

**QR por equipo**: Cada equipo genera un código QR que apunta a `{baseURL}/equipo/{id}/acceso` para iniciar una orden de trabajo validada.

### 2. Mantenimiento Preventivo

- Programación cronológica basada en frecuencia (diaria, semanal, mensual, trimestral, semestral, anual)
- Asignación de técnico interno o proveedor externo
- Checklist personalizable por tipo de equipo
- Alerta automática antes del vencimiento (configurable en días)
- Registro de tiempo real vs. tiempo estimado
- Estado: Programado → En ejecución → Completado → Verificado

### 3. Mantenimiento Correctivo + Helpdesk

- Creación de tickets desde cualquier punto (QR, portal web, app)
- Clasificación por prioridad: Crítica, Alta, Media, Baja
- Asignación automática o manual a técnico disponible
- Seguimiento en tiempo real con notificaciones (WebSocket)
- Escalamiento automático por SLA vencido
- Historial completo por equipo

### 4. Mantenimiento Predictivo

- Registro de lecturas y mediciones periódicas (temperatura, vibración, corriente, etc.)
- Definición de umbrales de alerta por equipo
- Gráficas de tendencia
- Alertas automáticas al superar umbrales
- Integración con órdenes de trabajo correctivas

### 5. Flujo de Orden de Trabajo (OT)

```
1. Escaneo QR del equipo
2. Validación: técnico autenticado + equipo asignado en OT
3. Registro inicio: fecha/hora automática
4. Subida de imágenes ANTES (máx. 2 imágenes obligatorias)
5. Ejecución del trabajo (checklist / observaciones)
6. Subida de imágenes DESPUÉS (máx. 2 imágenes obligatorias)
7. Firma digital del técnico
8. Firma digital de quien recibe (cliente/supervisor)
9. Cierre y generación de reporte PDF
```

### 6. Inventario de Repuestos

- Catálogo de repuestos con código, descripción, unidad de medida
- Stock mínimo y alertas de reabastecimiento
- Consumo por OT (descontar automáticamente del inventario)
- Historial de movimientos (entradas, salidas, devoluciones)
- Asociación de repuesto ↔ equipos compatibles
- Gestión de proveedores para reabastecimiento

### 7. Planificador de Mantenimiento

- Vista calendario (mensual / semanal) con drag-and-drop
- Asignación de técnicos internos o proveedores externos
- Visualización de carga de trabajo por técnico
- Conflictos de agenda detectados automáticamente
- Exportación a PDF / Excel del cronograma

### 8. Tablero de KPIs

Métricas en tiempo real:

| KPI | Descripción |
|---|---|
| Disponibilidad de equipos | % equipos operativos vs. total |
| Cumplimiento preventivo | OTs preventivas completadas a tiempo / total programadas |
| MTBF | Tiempo medio entre fallas por equipo |
| MTTR | Tiempo medio de reparación |
| Backlog correctivo | OTs abiertas con SLA vencido |
| Costo de mantenimiento | Por equipo, área, período |
| Índice de retrabajos | OTs reabiertas / total cerradas |
| Consumo de repuestos | Por período y por área |

### 9. Gestión de Usuarios y Roles

| Rol | Permisos |
|---|---|
| Administrador | Acceso total |
| Jefe de Mantenimiento | Reportes, planificador, aprobación OTs |
| Técnico Interno | Ejecutar OTs, registrar trabajos |
| Proveedor Externo | Solo OTs asignadas a su empresa |
| Solicitante | Crear tickets helpdesk, ver estado |
| Visualizador | Solo lectura dashboard y reportes |

### 10. Gestión de Proveedores

- Ficha de proveedor: NIT/RUC, contacto, especialidad
- Contratos y SLAs por proveedor
- Historial de trabajos realizados
- Evaluación de desempeño
- Acceso limitado al portal para sus OTs asignadas

---

## Modelo de Datos (Prisma - PostgreSQL)

### Entidades principales

```prisma
model Equipment {
  id            String   @id @default(cuid())
  code          String   @unique        // Código interno
  qrCode        String   @unique        // URL QR
  name          String
  serialNumber  String?
  model         String?
  brand         String?
  type          EquipmentType           // GENERAL | BIOMEDICAL
  category      String
  status        EquipmentStatus         // ACTIVE | MAINTENANCE | OUT_OF_SERVICE | DECOMMISSIONED
  locationId    String
  assetNumber   String?
  purchaseDate  DateTime?
  purchaseValue Decimal?
  location      Location @relation(...)
  workOrders    WorkOrder[]
  maintenancePlans MaintenancePlan[]
  measurements  PredictiveMeasurement[]
  spareParts    EquipmentSparePart[]
}

model WorkOrder {
  id            String   @id @default(cuid())
  code          String   @unique
  type          WOType          // PREVENTIVE | CORRECTIVE | PREDICTIVE
  priority      Priority        // CRITICAL | HIGH | MEDIUM | LOW
  status        WOStatus        // OPEN | IN_PROGRESS | COMPLETED | VERIFIED | CLOSED
  equipmentId   String
  technicianId  String?
  providerId    String?
  scheduledDate DateTime?
  startedAt     DateTime?
  completedAt   DateTime?
  beforeImages  String[]        // max 2 URLs
  afterImages   String[]        // max 2 URLs
  techSignature String?         // URL imagen firma técnico
  clientSignature String?       // URL imagen firma cliente
  checklist     Json?
  notes         String?
  spareParts    WOSparePart[]
  laborHours    Decimal?
}

model MaintenancePlan {
  id            String   @id @default(cuid())
  equipmentId   String
  frequency     Frequency       // DAILY | WEEKLY | MONTHLY | QUARTERLY | BIANNUAL | ANNUAL
  nextDueDate   DateTime
  alertDaysBefore Int    @default(7)
  checklistTemplate Json
  assignedTo    String?         // technicianId o providerId
}

model SparePart {
  id            String   @id @default(cuid())
  code          String   @unique
  name          String
  unit          String
  stock         Int      @default(0)
  minStock      Int      @default(0)
  providerId    String?
  movements     SparePartMovement[]
  equipments    EquipmentSparePart[]
}
```

---

## Validación QR + Flujo de Acceso

```
GET /equipo/:id/acceso
  → Verifica JWT del técnico
  → Verifica que la OT asignada al equipo esté en estado OPEN o IN_PROGRESS
  → Si válido: abre el formulario de ejecución de OT
  → Si no hay OT activa: opción para crear una nueva OT correctiva
```

El escáner QR (html5-qrcode) lee el código QR del equipo desde la cámara del dispositivo móvil, decodifica la URL y navega automáticamente a la ficha de ejecución.

---

## Imágenes en Órdenes de Trabajo

- Máximo **4 imágenes por OT**: 2 obligatorias ANTES de intervenir + 2 obligatorias DESPUÉS
- Formato aceptado: JPG, PNG, WEBP — máximo 5 MB cada una
- Compresión automática del lado cliente antes del upload
- Almacenamiento en Supabase Storage con URL pública firmada
- Vista previa inmediata en el formulario

---

## Firma Digital

- Componente `signature_pad` integrado en canvas HTML5
- Funciona en desktop (mouse) y móvil (touch)
- La firma se exporta como imagen PNG en base64
- Se almacena en Supabase Storage y la URL se guarda en la OT
- Dos firmas requeridas para cierre de OT:
  1. Técnico que realizó el trabajo
  2. Persona que recibe / supervisor del área

---

## API REST — Endpoints Principales

```
# Equipos
GET    /api/equipments                   # Listar con filtros
POST   /api/equipments                   # Crear equipo
GET    /api/equipments/:id               # Ficha equipo
PUT    /api/equipments/:id               # Actualizar
GET    /api/equipments/:id/qr            # Generar/obtener QR
GET    /api/equipments/:id/history       # Bitácora histórica

# Órdenes de Trabajo
GET    /api/work-orders                  # Listar con filtros
POST   /api/work-orders                  # Crear OT
GET    /api/work-orders/:id              # Detalle OT
PATCH  /api/work-orders/:id/status       # Cambiar estado
POST   /api/work-orders/:id/images       # Subir imágenes (antes/después)
POST   /api/work-orders/:id/signatures   # Guardar firmas
POST   /api/work-orders/:id/close        # Cerrar OT

# Planes de Mantenimiento
GET    /api/maintenance-plans            # Listar planes
POST   /api/maintenance-plans            # Crear plan
GET    /api/maintenance-plans/upcoming   # Próximos vencimientos

# Inventario
GET    /api/spare-parts                  # Listar repuestos
POST   /api/spare-parts                  # Crear repuesto
PATCH  /api/spare-parts/:id/stock        # Ajustar stock
GET    /api/spare-parts/alerts           # Alertas stock bajo

# KPIs
GET    /api/kpis/dashboard               # Todos los KPIs
GET    /api/kpis/equipment/:id           # KPIs por equipo
GET    /api/kpis/technician/:id          # KPIs por técnico

# Usuarios y Roles
GET    /api/users                        # Listar usuarios
POST   /api/users                        # Crear usuario
PATCH  /api/users/:id/role               # Cambiar rol

# Proveedores
GET    /api/providers                    # Listar proveedores
POST   /api/providers                    # Crear proveedor
GET    /api/providers/:id/performance    # Evaluación proveedor
```

---

## Variables de Entorno

```env
# server/.env
DATABASE_URL=postgresql://user:pass@localhost:5432/mantenimiento
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=8h
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
SUPABASE_BUCKET=maintenance-images
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=your-smtp-password
BASE_URL=https://yourdomain.com

# client/.env
VITE_API_URL=http://localhost:3001/api
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

---

## Comandos de Desarrollo

```bash
# Instalar dependencias
npm install                    # en /client y /server

# Base de datos
npx prisma migrate dev         # Crear/aplicar migraciones
npx prisma db seed             # Poblar datos de prueba
npx prisma studio              # GUI de la BD

# Desarrollo
npm run dev                    # Levantar cliente (puerto 5173) y servidor (puerto 3001)

# Build producción
npm run build                  # Compilar cliente
npm start                      # Iniciar servidor en producción

# Tests
npm run test                   # Vitest (cliente) + Jest (servidor)
npm run test:e2e               # Playwright
```

---

## Consideraciones de Seguridad

- JWT con expiración de 8 horas; refresh token con rotación
- Toda imagen validada por MIME type en el servidor antes de almacenar
- Rate limiting en endpoints de autenticación y upload
- Sanitización de inputs con Zod (cliente) + express-validator (servidor)
- CORS restringido a dominios autorizados
- Logs de auditoría para acciones críticas (cierre OT, cambio de rol, baja de equipo)
- Las firmas digitales son inmutables una vez guardadas

---

## Internacionalización

- Idioma por defecto: **Español (es-CO)**
- Formato de fechas: DD/MM/YYYY
- Formato de números: `#.###,##` (separador miles: punto, decimal: coma)
- Zona horaria: configurable por sede (default `America/Bogota`)
