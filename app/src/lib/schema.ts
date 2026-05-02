import { sqliteTable, text, integer, real, blob } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─── Helpers ────────────────────────────────────────────────────────────────
const id   = () => text('id').primaryKey();
const now  = () => text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const upd  = () => text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

// ─── Company ────────────────────────────────────────────────────────────────
export const company = sqliteTable('company', {
  id:      id(),
  name:    text('name').notNull(),
  nit:     text('nit'),
  address: text('address'),
  phone:   text('phone'),
  logoKey: text('logo_key'),     // R2 object key
  createdAt: now(),
  updatedAt: upd(),
});

// ─── Users ──────────────────────────────────────────────────────────────────
// role: ADMIN | CHIEF | TECHNICIAN | PROVIDER | VIEWER
export const users = sqliteTable('users', {
  id:         id(),
  email:      text('email').notNull().unique(),
  name:       text('name').notNull(),
  password:   text('password').notNull(),   // PBKDF2 hash  "algo:salt:hash"
  role:       text('role').notNull(),
  branchId:   text('branch_id'),
  active:     integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt:  now(),
  updatedAt:  upd(),
});

// ─── Branches ───────────────────────────────────────────────────────────────
export const branches = sqliteTable('branches', {
  id:        id(),
  name:      text('name').notNull(),
  city:      text('city'),
  address:   text('address'),
  phone:     text('phone'),
  timezone:  text('timezone').notNull().default('America/Bogota'),
  createdAt: now(),
  updatedAt: upd(),
});

// ─── Locations ──────────────────────────────────────────────────────────────
export const locations = sqliteTable('locations', {
  id:        id(),
  branchId:  text('branch_id').notNull().references(() => branches.id),
  building:  text('building'),
  floor:     text('floor'),
  area:      text('area').notNull(),
  createdAt: now(),
});

// ─── Equipment ──────────────────────────────────────────────────────────────
// type:   GENERAL | BIOMEDICAL
// status: ACTIVE | MAINTENANCE | OUT_OF_SERVICE | DECOMMISSIONED
export const equipment = sqliteTable('equipment', {
  id:             id(),
  code:           text('code').notNull().unique(),
  qrCode:         text('qr_code').notNull().unique(),
  name:           text('name').notNull(),
  serialNumber:   text('serial_number'),
  model:          text('model'),
  brand:          text('brand'),
  year:           integer('year'),
  type:           text('type').notNull().default('GENERAL'),
  category:       text('category').notNull(),
  subcategory:    text('subcategory'),
  status:         text('status').notNull().default('ACTIVE'),
  locationId:     text('location_id').references(() => locations.id),
  assetNumber:    text('asset_number'),
  purchaseDate:   text('purchase_date'),
  purchaseValue:  real('purchase_value'),
  notes:          text('notes'),
  createdAt:      now(),
  updatedAt:      upd(),
});

// ─── Maintenance Plans ───────────────────────────────────────────────────────
// frequency: DAILY | WEEKLY | MONTHLY | QUARTERLY | BIANNUAL | ANNUAL
export const maintenancePlans = sqliteTable('maintenance_plans', {
  id:                    id(),
  equipmentId:           text('equipment_id').notNull().references(() => equipment.id),
  frequency:             text('frequency').notNull(),
  nextDueDate:           text('next_due_date').notNull(),
  alertDaysBefore:       integer('alert_days_before').notNull().default(7),
  checklistTemplate:     text('checklist_template'),   // JSON string
  estimatedHours:        real('estimated_hours'),
  assignedToUserId:      text('assigned_to_user_id'),
  assignedToProviderId:  text('assigned_to_provider_id'),
  active:                integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt:             now(),
  updatedAt:             upd(),
});

// ─── Work Orders ─────────────────────────────────────────────────────────────
// type:     PREVENTIVE | CORRECTIVE | PREDICTIVE
// priority: CRITICAL | HIGH | MEDIUM | LOW
// status:   OPEN | IN_PROGRESS | COMPLETED | VERIFIED | CLOSED
export const workOrders = sqliteTable('work_orders', {
  id:                text('id').primaryKey(),
  code:              text('code').notNull().unique(),
  type:              text('type').notNull(),
  priority:          text('priority').notNull().default('MEDIUM'),
  status:            text('status').notNull().default('OPEN'),
  equipmentId:       text('equipment_id').notNull().references(() => equipment.id),
  technicianId:      text('technician_id'),
  providerId:        text('provider_id'),
  helpdeskTicketId:  text('helpdesk_ticket_id'),
  scheduledDate:     text('scheduled_date'),
  startedAt:         text('started_at'),
  completedAt:       text('completed_at'),
  estimatedHours:    real('estimated_hours'),
  laborHours:        real('labor_hours'),
  beforeImages:      text('before_images'),    // JSON array of R2 keys
  afterImages:       text('after_images'),     // JSON array of R2 keys
  techSignatureKey:  text('tech_signature_key'),
  clientSignatureKey:text('client_signature_key'),
  signerName:        text('signer_name'),
  signerRole:        text('signer_role'),
  checklist:         text('checklist'),        // JSON
  notes:             text('notes'),
  closedReason:      text('closed_reason'),
  createdAt:         now(),
  updatedAt:         upd(),
});

// ─── WO Spare Parts ──────────────────────────────────────────────────────────
export const woSpareParts = sqliteTable('wo_spare_parts', {
  id:           id(),
  workOrderId:  text('work_order_id').notNull().references(() => workOrders.id),
  sparePartId:  text('spare_part_id').notNull().references(() => spareParts.id),
  quantity:     integer('quantity').notNull().default(1),
  createdAt:    now(),
});

// ─── Spare Parts ─────────────────────────────────────────────────────────────
export const spareParts = sqliteTable('spare_parts', {
  id:          id(),
  code:        text('code').notNull().unique(),
  name:        text('name').notNull(),
  description: text('description'),
  unit:        text('unit').notNull().default('UND'),
  category:    text('category'),
  providerId:  text('provider_id'),
  createdAt:   now(),
  updatedAt:   upd(),
});

export const sparePartStock = sqliteTable('spare_part_stock', {
  id:          id(),
  sparePartId: text('spare_part_id').notNull().references(() => spareParts.id),
  branchId:    text('branch_id').notNull().references(() => branches.id),
  quantity:    integer('quantity').notNull().default(0),
  minStock:    integer('min_stock').notNull().default(0),
  updatedAt:   upd(),
});

// movement_type: IN | OUT | ADJUSTMENT | RETURN
export const sparePartMovements = sqliteTable('spare_part_movements', {
  id:            id(),
  sparePartId:   text('spare_part_id').notNull().references(() => spareParts.id),
  branchId:      text('branch_id').notNull().references(() => branches.id),
  workOrderId:   text('work_order_id'),
  movementType:  text('movement_type').notNull(),
  quantity:      integer('quantity').notNull(),
  notes:         text('notes'),
  createdBy:     text('created_by'),
  createdAt:     now(),
});

// ─── Predictive Measurements ─────────────────────────────────────────────────
export const predictiveMeasurements = sqliteTable('predictive_measurements', {
  id:            id(),
  equipmentId:   text('equipment_id').notNull().references(() => equipment.id),
  variable:      text('variable').notNull(),
  unit:          text('unit').notNull(),
  value:         real('value').notNull(),
  minThreshold:  real('min_threshold'),
  maxThreshold:  real('max_threshold'),
  recordedAt:    text('recorded_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  recordedBy:    text('recorded_by'),
});

// ─── Helpdesk Tickets ────────────────────────────────────────────────────────
// requestType:  EQUIPMENT_FAILURE | MAINTENANCE_REQUEST | OTHER
// priority:     CRITICAL | HIGH | MEDIUM | LOW
// status:       OPEN | IN_PROGRESS | ESCALATED | RESOLVED | CLOSED
export const helpdeskTickets = sqliteTable('helpdesk_tickets', {
  id:                 id(),
  code:               text('code').notNull().unique(),
  trackingToken:      text('tracking_token').notNull().unique(),
  requesterName:      text('requester_name').notNull(),
  requesterEmail:     text('requester_email').notNull(),
  requesterPhone:     text('requester_phone'),
  branchId:           text('branch_id').notNull().references(() => branches.id),
  area:               text('area').notNull(),
  requestType:        text('request_type').notNull(),
  priority:           text('priority').notNull().default('MEDIUM'),
  description:        text('description').notNull(),
  attachments:        text('attachments'),   // JSON array of R2 keys
  status:             text('status').notNull().default('OPEN'),
  assignedToId:       text('assigned_to_id'),
  equipmentId:        text('equipment_id'),
  relatedWorkOrderId: text('related_work_order_id'),
  slaDeadline:        text('sla_deadline'),
  resolvedAt:         text('resolved_at'),
  closedAt:           text('closed_at'),
  resolutionNotes:    text('resolution_notes'),
  createdAt:          now(),
  updatedAt:          upd(),
});

export const ticketComments = sqliteTable('ticket_comments', {
  id:         id(),
  ticketId:   text('ticket_id').notNull().references(() => helpdeskTickets.id),
  authorId:   text('author_id'),
  authorName: text('author_name').notNull(),
  content:    text('content').notNull(),
  isInternal: integer('is_internal', { mode: 'boolean' }).notNull().default(false),
  createdAt:  now(),
});

// ─── Providers ───────────────────────────────────────────────────────────────
export const providers = sqliteTable('providers', {
  id:        id(),
  nit:       text('nit'),
  name:      text('name').notNull(),
  contact:   text('contact'),
  email:     text('email'),
  phone:     text('phone'),
  specialty: text('specialty'),
  city:      text('city'),
  active:    integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: now(),
  updatedAt: upd(),
});

// ─── Attachments (general, e.g. equipment manuals) ───────────────────────────
export const attachments = sqliteTable('attachments', {
  id:          id(),
  entityType:  text('entity_type').notNull(),  // 'equipment' | 'work_order' | ...
  entityId:    text('entity_id').notNull(),
  fileName:    text('file_name').notNull(),
  r2Key:       text('r2_key').notNull(),
  mimeType:    text('mime_type'),
  sizeBytes:   integer('size_bytes'),
  uploadedBy:  text('uploaded_by'),
  createdAt:   now(),
});

// ─── Audit Log ───────────────────────────────────────────────────────────────
export const auditLog = sqliteTable('audit_log', {
  id:        id(),
  userId:    text('user_id'),
  action:    text('action').notNull(),
  entityType:text('entity_type'),
  entityId:  text('entity_id'),
  details:   text('details'),   // JSON
  createdAt: now(),
});
