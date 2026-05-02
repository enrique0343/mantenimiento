# Sistema de Gestión de Mantenimiento General y Biomédico

## Visión General

Aplicación web full-stack para la gestión integral de mantenimiento **preventivo**, **correctivo** y **predictivo** de equipos generales y biomédicos en una empresa con múltiples sucursales. Incluye helpdesk con seguimiento por email, inventario, planificador, KPIs, acceso por QR y firma digital.

---

## Decisiones de Arquitectura (Confirmadas)

| Aspecto | Decisión |
|---|---|
| Modelo de empresa | Una sola empresa, múltiples sucursales |
| Logo en PDFs | Logo configurable por el administrador desde la app |
| Usuarios concurrentes | Menos de 10 |
| Despliegue | Cloudflare Pages (frontend) + servidor Node en VPS |
| Acceso móvil | Navegador móvil (no se requiere PWA) |
| Notificaciones | Solo email (Nodemailer) |
| Regulaciones biomédicas | No aplica por ahora |
| Exportación KPIs | No requerida |
| Idioma | Español (es-CO) |
| Integraciones externas | No aplica por ahora |

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
| Almacenamiento | Supabase Storage (imágenes y firmas) |
| QR | qrcode + html5-qrcode |
| Firma digital | signature_pad |
| Gráficos/KPIs | Recharts |
| Email | Nodemailer (SMTP) |
| PDF | @react-pdf/renderer (generación en el cliente) |

> **Nota:** Socket.io no se utiliza. Las notificaciones en tiempo real se reemplazan por email.

---

## Arquitectura del Proyecto

```
mantenimiento/
├── client/                     # Frontend React
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/             # shadcn/ui base components
│   │   │   ├── qr/             # Escáner y generador QR
│   │   │   ├── signature/      # Componente firma digital
│   │   │   ├── images/         # Upload hasta 4 imágenes (2 antes + 2 después)
│   │   │   └── forms/          # Formularios reutilizables
│   │   ├── pages/
│   │   │   ├── Dashboard/      # KPIs y tablero
│   │   │   ├── Equipment/      # Fichas de equipos
│   │   │   ├── Maintenance/    # Preventivo / Correctivo / Predictivo
│   │   │   ├── Helpdesk/       # Mesa de ayuda (vista interna y pública)
│   │   │   ├── Planner/        # Planificador con calendario
│   │   │   ├── Inventory/      # Repuestos e insumos
│   │   │   ├── Users/          # Gestión de usuarios
│   │   │   ├── Providers/      # Proveedores externos
│   │   │   ├── Reports/        # Reportes y bitácoras
│   │   │   └── Settings/       # Config general: logo, empresa, sucursales, SMTP
│   │   ├── hooks/
│   │   ├── store/              # Zustand stores
│   │   ├── lib/                # Utilidades, API client, email templates
│   │   └── types/              # TypeScript interfaces
├── server/
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── middleware/         # Auth, validación, upload
│   │   ├── services/
│   │   │   ├── email.service.ts   # Nodemailer + plantillas
│   │   │   └── storage.service.ts # Supabase Storage
│   │   └── utils/
│   └── prisma/
│       └── schema.prisma
└── shared/                     # Tipos compartidos cliente/servidor
```

---

## Módulos del Sistema

### 1. Configuración General (Admin)

- Datos de la empresa: nombre, NIT, dirección, teléfono
- **Logo**: upload del logo que se usará en PDFs y encabezados (almacenado en Supabase Storage)
- Gestión de sucursales: nombre, ciudad, dirección, teléfono por sucursal
- Configuración SMTP para envío de emails
- Zona horaria por sucursal (default `America/Bogota`)

### 2. Gestión de Sucursales y Ubicaciones

Jerarquía de ubicación de equipos:

```
Empresa
  └── Sucursal (ej. Sede Norte, Sede Sur, Planta Principal)
        └── Edificio / Bloque (opcional)
              └── Piso / Nivel
                    └── Área / Servicio (ej. UCI, Radiología, Taller)
```

Cada equipo queda asociado a una ubicación específica dentro de esta jerarquía.

### 3. Gestión de Equipos

Cada equipo tiene una **ficha técnica** completa:

- **Identificación**: Código interno, código QR único, número de serie, modelo, marca, año de fabricación
- **Clasificación**: Tipo de equipo (general / biomédico), categoría, subcategoría
- **Ubicación**: Sucursal → Edificio → Piso → Área/Servicio
- **Activos fijos**: Número de activo, valor de adquisición, fecha de compra, estado (activo / inactivo / dado de baja)
- **Documentación**: Manual (PDF adjunto), certificados, bitácora histórica
- **Estado actual**: Operativo, en mantenimiento, fuera de servicio

**QR por equipo**: Genera un código QR que apunta a `{baseURL}/equipo/{id}/acceso` para iniciar una OT validada.

### 4. Mantenimiento Preventivo

- Programación cronológica por frecuencia (diaria, semanal, mensual, trimestral, semestral, anual)
- Asignación de técnico interno o proveedor externo
- Checklist personalizable por tipo de equipo
- Alerta por email antes del vencimiento (días configurables, default 7)
- Registro de tiempo real vs. tiempo estimado
- Estado: `Programado → En ejecución → Completado → Verificado`

### 5. Mantenimiento Correctivo

- Creación de OT correctiva desde: escaneo QR, portal web, o conversión desde ticket de helpdesk
- Clasificación por prioridad: Crítica, Alta, Media, Baja
- Asignación manual a técnico disponible
- Notificación por email al técnico asignado
- Escalamiento por email cuando SLA vence sin atender
- Historial completo por equipo

### 6. Mantenimiento Predictivo

- Registro de lecturas y mediciones periódicas (temperatura, vibración, corriente, presión, etc.)
- Definición de umbrales de alerta (mín./máx.) por equipo y tipo de medición
- Gráficas de tendencia por variable y período
- Alerta por email al superar un umbral
- Integración: desde una alerta predictiva se puede crear una OT correctiva

### 7. Flujo de Orden de Trabajo (OT)

```
1. Escaneo QR del equipo (o apertura manual desde la app)
2. Validación: técnico autenticado + equipo coincide con la OT asignada
3. Registro inicio: fecha y hora automática
4. Subida de imágenes ANTES (2 imágenes obligatorias)
5. Ejecución del trabajo: checklist + observaciones libres
6. Registro de repuestos utilizados (descuenta stock automáticamente)
7. Subida de imágenes DESPUÉS (2 imágenes obligatorias)
8. Firma digital del técnico
9. Firma digital de quien recibe el trabajo (supervisor / cliente del área)
10. Cierre → OT queda en estado COMPLETADO
11. Exportación opcional a PDF individual
```

### 8. Helpdesk — Mesa de Ayuda

El helpdesk opera como un módulo **semi-público**: cualquier persona de la empresa puede enviar un ticket sin necesidad de tener usuario en el sistema.

#### Flujo de un ticket

```
Solicitante llena formulario público
        ↓
Sistema asigna número único de ticket
        ↓
Email automático al solicitante: "Ticket #XXXX recibido"
        ↓
Técnico/Jefe recibe email de nuevo ticket
        ↓
Técnico actualiza estado o agrega comentario
        ↓
Email automático al solicitante con la actualización
        ↓
Ticket se cierra → Email de confirmación al solicitante
```

#### Formulario público de creación de ticket

Accesible en `{baseURL}/helpdesk/nuevo` sin login. Campos:

| Campo | Tipo | Requerido |
|---|---|---|
| Nombre del solicitante | Texto | Sí |
| Correo electrónico | Email | Sí |
| Teléfono / Extensión | Texto | No |
| Sucursal | Select | Sí |
| Área / Servicio | Texto | Sí |
| Tipo de solicitud | Select: Falla de equipo / Solicitud de mantenimiento / Otro | Sí |
| Equipo relacionado | Búsqueda por código o nombre (opcional) | No |
| Prioridad sugerida | Select: Crítica / Alta / Media / Baja | Sí |
| Descripción del problema | Textarea | Sí |
| Imagen adjunta | Upload (máx. 2, JPG/PNG, 5 MB c/u) | No |

#### Estados del ticket

```
ABIERTO → EN_PROGRESO → RESUELTO → CERRADO
                  ↓
            ESCALADO (SLA vencido)
```

#### Notificaciones por email del helpdesk

| Evento | Destinatario |
|---|---|
| Nuevo ticket creado | Solicitante (confirmación) + Técnicos/Jefe (nuevo caso) |
| Cambio de estado | Solicitante |
| Nuevo comentario del técnico | Solicitante |
| SLA próximo a vencer | Técnico asignado + Jefe de Mantenimiento |
| Ticket cerrado | Solicitante (resumen de resolución) |

#### Seguimiento público

El email de confirmación incluye un enlace `{baseURL}/helpdesk/ticket/{token}` donde el solicitante puede ver el estado e historial de su ticket **sin necesidad de crear una cuenta**.

#### Conversión a OT correctiva

Desde la vista interna de un ticket, el técnico puede crear directamente una OT correctiva vinculada al ticket. El ticket queda en estado `EN_PROGRESO` y referencia la OT generada.

#### Vista interna (usuarios autenticados)

- Lista de tickets con filtros: estado, prioridad, sucursal, técnico asignado, fecha
- Detalle del ticket con historial de comentarios
- Asignación de técnico responsable
- Cierre con nota de resolución
- Indicador visual de SLA (verde / amarillo / rojo)

### 9. Inventario de Repuestos

- Catálogo con código, descripción, unidad de medida, categoría
- Stock por sucursal (cada sucursal maneja su propio inventario)
- Stock mínimo con alerta por email automática al llegar al umbral
- Consumo automático al cerrar una OT (descuenta del stock de la sucursal del equipo)
- Historial de movimientos: entradas, salidas por OT, ajustes manuales, devoluciones
- Asociación repuesto ↔ equipos compatibles
- Vinculación con proveedor suministrador

### 10. Planificador de Mantenimiento

- Vista calendario mensual y semanal
- Drag-and-drop para reprogramar OTs preventivas
- Asignación de técnicos internos o proveedores externos
- Visualización de carga de trabajo por técnico (horas asignadas vs. disponibles)
- Detección automática de conflictos de agenda
- Exportación del cronograma a PDF

### 11. Tablero de KPIs

Métricas filtrables por sucursal y período:

| KPI | Descripción |
|---|---|
| Disponibilidad de equipos | % equipos operativos vs. total |
| Cumplimiento preventivo | OTs preventivas completadas a tiempo / total programadas |
| MTBF | Tiempo medio entre fallas por equipo |
| MTTR | Tiempo medio de reparación |
| Backlog correctivo | OTs abiertas con SLA vencido |
| Costo de mantenimiento | Por equipo, área, período |
| Índice de retrabajos | OTs reabiertas / total cerradas |
| Consumo de repuestos | Por período y por sucursal |
| Tickets helpdesk | Abiertos / resueltos / tiempo promedio de respuesta |

### 12. Gestión de Usuarios y Roles

| Rol | Permisos |
|---|---|
| Administrador | Acceso total, configuración del sistema |
| Jefe de Mantenimiento | Reportes, planificador, aprobación OTs, gestión helpdesk |
| Técnico Interno | Ejecutar OTs, registrar trabajos, atender tickets |
| Proveedor Externo | Solo OTs asignadas a su empresa |
| Visualizador | Solo lectura: dashboard y reportes |

> El rol **Solicitante de Helpdesk** no requiere cuenta: accede únicamente al formulario público y al enlace de seguimiento por email.

### 13. Gestión de Proveedores

- Ficha: NIT/RUC, razón social, contacto, especialidad, ciudad
- Contratos y SLAs definidos por proveedor
- Historial de trabajos (OTs asignadas y completadas)
- Evaluación de desempeño (calificación manual por OT)
- Login de proveedor: acceso limitado solo a sus OTs asignadas

---

## Modelo de Datos (Prisma - PostgreSQL)

```prisma
model Company {
  id          String     @id @default(cuid())
  name        String
  nit         String?
  address     String?
  phone       String?
  logoUrl     String?    // URL del logo en Supabase Storage
  branches    Branch[]
}

model Branch {
  id          String     @id @default(cuid())
  companyId   String
  name        String
  city        String?
  address     String?
  phone       String?
  timezone    String     @default("America/Bogota")
  company     Company    @relation(...)
  locations   Location[]
  users       User[]
  inventory   SparePartStock[]
}

model Location {
  id          String     @id @default(cuid())
  branchId    String
  building    String?
  floor       String?
  area        String
  branch      Branch     @relation(...)
  equipments  Equipment[]
}

model Equipment {
  id            String          @id @default(cuid())
  code          String          @unique
  qrCode        String          @unique     // URL de acceso QR
  name          String
  serialNumber  String?
  model         String?
  brand         String?
  year          Int?
  type          EquipmentType               // GENERAL | BIOMEDICAL
  category      String
  subcategory   String?
  status        EquipmentStatus             // ACTIVE | MAINTENANCE | OUT_OF_SERVICE | DECOMMISSIONED
  locationId    String
  assetNumber   String?
  purchaseDate  DateTime?
  purchaseValue Decimal?
  location      Location        @relation(...)
  workOrders    WorkOrder[]
  maintenancePlans MaintenancePlan[]
  measurements  PredictiveMeasurement[]
  spareParts    EquipmentSparePart[]
  helpdeskTickets HelpdeskTicket[]
}

model WorkOrder {
  id              String    @id @default(cuid())
  code            String    @unique
  type            WOType              // PREVENTIVE | CORRECTIVE | PREDICTIVE
  priority        Priority            // CRITICAL | HIGH | MEDIUM | LOW
  status          WOStatus            // OPEN | IN_PROGRESS | COMPLETED | VERIFIED | CLOSED
  equipmentId     String
  technicianId    String?
  providerId      String?
  helpdeskTicketId String?            // OT generada desde un ticket
  scheduledDate   DateTime?
  startedAt       DateTime?
  completedAt     DateTime?
  estimatedHours  Decimal?
  laborHours      Decimal?
  beforeImages    String[]            // max 2 URLs Supabase
  afterImages     String[]            // max 2 URLs Supabase
  techSignature   String?             // URL PNG firma técnico
  clientSignature String?             // URL PNG firma receptor
  signerName      String?             // Nombre de quien recibe
  signerRole      String?             // Cargo de quien recibe
  checklist       Json?
  notes           String?
  spareParts      WOSparePart[]
  equipment       Equipment  @relation(...)
  helpdeskTicket  HelpdeskTicket? @relation(...)
}

model MaintenancePlan {
  id                String    @id @default(cuid())
  equipmentId       String
  frequency         Frequency           // DAILY | WEEKLY | MONTHLY | QUARTERLY | BIANNUAL | ANNUAL
  nextDueDate       DateTime
  alertDaysBefore   Int       @default(7)
  checklistTemplate Json
  estimatedHours    Decimal?
  assignedToUserId  String?
  assignedToProviderId String?
  equipment         Equipment @relation(...)
}

model PredictiveMeasurement {
  id          String    @id @default(cuid())
  equipmentId String
  variable    String    // ej. "temperatura", "vibración"
  unit        String    // ej. "°C", "mm/s"
  value       Decimal
  minThreshold Decimal?
  maxThreshold Decimal?
  recordedAt  DateTime  @default(now())
  recordedBy  String
  equipment   Equipment @relation(...)
}

model HelpdeskTicket {
  id              String          @id @default(cuid())
  code            String          @unique    // Ej: HD-2024-0042
  trackingToken   String          @unique    // Token para enlace público sin login
  // Datos del solicitante (no requiere cuenta)
  requesterName   String
  requesterEmail  String
  requesterPhone  String?
  branchId        String
  area            String
  // Clasificación
  requestType     RequestType     // EQUIPMENT_FAILURE | MAINTENANCE_REQUEST | OTHER
  priority        Priority
  description     String
  attachments     String[]        // max 2 URLs imágenes
  // Gestión interna
  status          TicketStatus    // OPEN | IN_PROGRESS | ESCALATED | RESOLVED | CLOSED
  assignedToId    String?
  equipmentId     String?
  relatedWorkOrderId String?
  slaDeadline     DateTime?
  resolvedAt      DateTime?
  closedAt        DateTime?
  resolutionNotes String?
  comments        TicketComment[]
  equipment       Equipment?      @relation(...)
  branch          Branch          @relation(...)
}

model TicketComment {
  id        String   @id @default(cuid())
  ticketId  String
  authorId  String?          // null si es comentario del sistema
  authorName String
  content   String
  isInternal Boolean @default(false)  // true = nota interna, no se muestra al solicitante
  createdAt DateTime @default(now())
  ticket    HelpdeskTicket @relation(...)
}

model SparePart {
  id          String   @id @default(cuid())
  code        String   @unique
  name        String
  description String?
  unit        String
  category    String?
  providerId  String?
  stock       SparePartStock[]
  movements   SparePartMovement[]
  equipments  EquipmentSparePart[]
}

model SparePartStock {
  id          String    @id @default(cuid())
  sparePartId String
  branchId    String
  quantity    Int       @default(0)
  minStock    Int       @default(0)
  sparePart   SparePart @relation(...)
  branch      Branch    @relation(...)
  @@unique([sparePartId, branchId])
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  password  String
  role      Role     // ADMIN | MAINTENANCE_CHIEF | TECHNICIAN | PROVIDER | VIEWER
  branchId  String?
  active    Boolean  @default(true)
  branch    Branch?  @relation(...)
}

model Provider {
  id          String   @id @default(cuid())
  nit         String?
  name        String
  contact     String?
  email       String?
  phone       String?
  specialty   String?
  city        String?
  active      Boolean  @default(true)
  workOrders  WorkOrder[]
}
```

---

## Helpdesk — Emails Automáticos (Plantillas)

| Evento | Asunto del email |
|---|---|
| Ticket creado | `[HD-XXXX] Su solicitud ha sido recibida` |
| Ticket asignado a técnico | `[HD-XXXX] Su solicitud está siendo atendida` |
| Nuevo comentario público | `[HD-XXXX] Respuesta a su solicitud` |
| Ticket resuelto | `[HD-XXXX] Su solicitud ha sido resuelta` |
| Ticket cerrado | `[HD-XXXX] Caso cerrado — Resumen` |
| SLA próximo a vencer | `[HD-XXXX] Alerta: SLA próximo a vencer` (a técnico y jefe) |

Cada email incluye el número de ticket, descripción corta y el enlace de seguimiento público.

---

## Validación QR + Flujo de Acceso

```
GET /equipo/:id/acceso
  → Si no hay sesión activa: redirige al login
  → Verifica JWT del técnico
  → Verifica que exista una OT activa (OPEN o IN_PROGRESS) para ese equipo
  → Si válido: abre el formulario de ejecución de OT
  → Si no hay OT activa: opción para abrir una nueva OT correctiva
```

El escáner QR (html5-qrcode) lee el QR del equipo desde la cámara del móvil, decodifica la URL y navega automáticamente a la vista de ejecución.

---

## Imágenes en Órdenes de Trabajo

- Máximo **4 imágenes por OT**: 2 obligatorias ANTES + 2 obligatorias DESPUÉS
- Formato aceptado: JPG, PNG, WEBP — máximo 5 MB cada una
- Compresión automática en el cliente antes del upload
- Almacenamiento en Supabase Storage con URL firmada
- Vista previa inmediata en el formulario

---

## Firma Digital

- `signature_pad` sobre canvas HTML5 — funciona con mouse y touch
- Se exporta como PNG en base64, se almacena en Supabase Storage
- Dos firmas requeridas para cerrar una OT:
  1. Técnico que realizó el trabajo (nombre y cédula)
  2. Persona que recibe (nombre y cargo)
- Las firmas son inmutables una vez guardadas

---

## Exportación a PDF

### PDF por Orden de Trabajo individual

| Sección | Contenido |
|---|---|
| Encabezado | Logo empresa, nombre del sistema, número de OT, fecha de emisión |
| Ficha del equipo | Código, nombre, marca, modelo, serie, sucursal, área, tipo |
| Datos de la OT | Tipo, prioridad, estado, técnico, proveedor |
| Tiempos | Fecha programada, inicio real, fin real, horas de trabajo |
| Checklist ejecutado | Ítems con estado (cumplido / no cumplido / N/A) |
| Repuestos utilizados | Código, descripción, cantidad, unidad |
| Imágenes | 2 fotos ANTES + 2 fotos DESPUÉS embebidas |
| Observaciones | Notas libres del técnico |
| Firmas | Imagen firma técnico + firma receptor, nombre, cargo |
| Pie de página | Página X/Y, fecha/hora de generación |

### Otros tipos de exportación

- **Bitácora de equipo** → todas las OTs de un equipo en un rango de fechas
- **Cronograma** → planificador mensual/semanal en PDF

**Implementación:** `@react-pdf/renderer` — generación en el navegador, descarga directa sin llamada al servidor.

---

## API REST — Endpoints Principales

```
# Configuración
GET    /api/settings                        # Config de empresa (logo, nombre, etc.)
PUT    /api/settings                        # Actualizar config
POST   /api/settings/logo                   # Subir logo

# Sucursales
GET    /api/branches                        # Listar sucursales
POST   /api/branches                        # Crear sucursal
PUT    /api/branches/:id                    # Actualizar sucursal

# Equipos
GET    /api/equipments                      # Listar con filtros (branch, type, status)
POST   /api/equipments                      # Crear equipo
GET    /api/equipments/:id                  # Ficha equipo
PUT    /api/equipments/:id                  # Actualizar
GET    /api/equipments/:id/qr               # Generar/obtener QR
GET    /api/equipments/:id/history          # Bitácora histórica (OTs)
GET    /api/equipments/:id/report           # Datos para PDF bitácora (?from=&to=)

# Órdenes de Trabajo
GET    /api/work-orders                     # Listar con filtros
POST   /api/work-orders                     # Crear OT
GET    /api/work-orders/:id                 # Detalle OT
PATCH  /api/work-orders/:id/status          # Cambiar estado
POST   /api/work-orders/:id/images          # Subir imágenes (before | after)
POST   /api/work-orders/:id/signatures      # Guardar firmas
POST   /api/work-orders/:id/spare-parts     # Registrar repuestos usados
POST   /api/work-orders/:id/close           # Cerrar OT
GET    /api/work-orders/:id/pdf             # Datos estructurados para PDF

# Planes de Mantenimiento
GET    /api/maintenance-plans               # Listar planes
POST   /api/maintenance-plans               # Crear plan
PUT    /api/maintenance-plans/:id           # Actualizar plan
GET    /api/maintenance-plans/upcoming      # Próximos vencimientos

# Predictivo
GET    /api/measurements/:equipmentId       # Lecturas de un equipo
POST   /api/measurements                    # Registrar lectura

# Helpdesk
GET    /api/helpdesk/tickets                # Listar tickets (usuarios internos)
POST   /api/helpdesk/tickets                # Crear ticket (público, sin auth)
GET    /api/helpdesk/tickets/:id            # Detalle (usuarios internos)
GET    /api/helpdesk/track/:token           # Seguimiento público por token
PATCH  /api/helpdesk/tickets/:id/status     # Cambiar estado (interno)
POST   /api/helpdesk/tickets/:id/assign     # Asignar técnico
POST   /api/helpdesk/tickets/:id/comments   # Agregar comentario
POST   /api/helpdesk/tickets/:id/convert    # Convertir a OT correctiva

# Inventario
GET    /api/spare-parts                     # Listar repuestos
POST   /api/spare-parts                     # Crear repuesto
GET    /api/spare-parts/alerts              # Alertas de stock bajo
PATCH  /api/spare-parts/:id/stock           # Ajuste manual de stock
GET    /api/spare-parts/:id/movements       # Historial de movimientos

# KPIs
GET    /api/kpis/dashboard                  # KPIs globales (?branch=&from=&to=)
GET    /api/kpis/equipment/:id              # KPIs por equipo
GET    /api/kpis/technician/:id             # KPIs por técnico

# Usuarios y Roles
GET    /api/users                           # Listar usuarios
POST   /api/users                           # Crear usuario
PATCH  /api/users/:id                       # Actualizar usuario
PATCH  /api/users/:id/role                  # Cambiar rol

# Proveedores
GET    /api/providers                       # Listar proveedores
POST   /api/providers                       # Crear proveedor
GET    /api/providers/:id/performance       # Evaluación proveedor
```

---

## Notificaciones por Email — Resumen General

| Evento | Destinatario |
|---|---|
| Nuevo ticket helpdesk | Solicitante + Jefe/Técnicos |
| Cambio de estado del ticket | Solicitante |
| Comentario público en ticket | Solicitante |
| SLA de ticket próximo a vencer | Técnico asignado + Jefe |
| Ticket cerrado | Solicitante |
| OT asignada a técnico | Técnico |
| OT preventiva próxima a vencer | Técnico asignado + Jefe |
| SLA de OT correctiva vencido | Técnico asignado + Jefe |
| Stock bajo de repuesto | Jefe de Mantenimiento + Admin |
| Umbral predictivo superado | Jefe de Mantenimiento + Admin |

---

## Variables de Entorno

```env
# server/.env
DATABASE_URL=postgresql://user:pass@localhost:5432/mantenimiento
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=8h
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
SUPABASE_BUCKET=maintenance-files
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM_NAME=Gestión de Mantenimiento
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
cd client && npm install
cd server && npm install

# Base de datos
cd server && npx prisma migrate dev
cd server && npx prisma db seed
cd server && npx prisma studio

# Desarrollo
cd client && npm run dev     # Puerto 5173
cd server && npm run dev     # Puerto 3001

# Build producción
cd client && npm run build   # Genera /dist para Cloudflare Pages
cd server && npm start
```

---

## Consideraciones de Seguridad

- JWT con expiración 8 horas; refresh token con rotación
- El formulario público de helpdesk no requiere auth; protegido con rate limiting y CAPTCHA opcional
- El enlace de seguimiento usa un token opaco de 32 bytes (no predecible)
- Imágenes validadas por MIME type en el servidor antes de almacenar en Supabase
- Rate limiting en endpoints de autenticación, upload y creación de tickets
- Sanitización de inputs: Zod (cliente) + express-validator (servidor)
- CORS restringido a dominios autorizados
- Logs de auditoría para: cierre de OT, cambio de rol, baja de equipo, cierre de ticket
- Las firmas digitales son inmutables una vez guardadas

---

## Internacionalización

- Idioma: **Español (es-CO)**
- Formato de fechas: DD/MM/YYYY
- Formato de números: `#.###,##`
- Zona horaria: configurable por sucursal (default `America/Bogota`)
