// ─── Auth ─────────────────────────────────────────────────────────────────────

export type Role = 'ADMIN' | 'MAINTENANCE_CHIEF' | 'TECHNICIAN' | 'PROVIDER' | 'VIEWER';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
}

// ─── Company / Branch ─────────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  nit?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
}

export interface Branch {
  id: string;
  name: string;
  city?: string;
  address?: string;
  phone?: string;
  timezone: string;
  active: boolean;
  locations?: Location[];
}

export interface Location {
  id: string;
  branchId: string;
  building?: string;
  floor?: string;
  area: string;
}

// ─── Equipment ────────────────────────────────────────────────────────────────

export type EquipmentType = 'GENERAL' | 'BIOMEDICAL';
export type EquipmentStatus = 'ACTIVE' | 'MAINTENANCE' | 'OUT_OF_SERVICE' | 'DECOMMISSIONED';

export interface Equipment {
  id: string;
  code: string;
  qrCode: string;
  name: string;
  serialNumber?: string;
  model?: string;
  brand?: string;
  year?: number;
  type: EquipmentType;
  category: string;
  subcategory?: string;
  status: EquipmentStatus;
  locationId: string;
  location?: Location & { branch?: Branch };
  assetNumber?: string;
  purchaseDate?: string;
  purchaseValue?: number;
  notes?: string;
  createdAt: string;
}

// ─── Work Orders ──────────────────────────────────────────────────────────────

export type WOType = 'PREVENTIVE' | 'CORRECTIVE' | 'PREDICTIVE';
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type WOStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED' | 'CLOSED';

export interface ChecklistItem {
  id: string;
  item: string;
  required: boolean;
  status?: 'OK' | 'FAIL' | 'NA';
  notes?: string;
}

export interface WorkOrder {
  id: string;
  code: string;
  type: WOType;
  priority: Priority;
  status: WOStatus;
  equipmentId: string;
  equipment?: Equipment;
  technicianId?: string;
  technician?: AuthUser;
  providerId?: string;
  helpdeskTicketId?: string;
  scheduledDate?: string;
  startedAt?: string;
  completedAt?: string;
  estimatedHours?: number;
  laborHours?: number;
  beforeImages: string[];
  afterImages: string[];
  techSignature?: string;
  clientSignature?: string;
  signerName?: string;
  signerRole?: string;
  checklist?: ChecklistItem[];
  notes?: string;
  createdAt: string;
}

// ─── Maintenance Plans ────────────────────────────────────────────────────────

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'BIANNUAL' | 'ANNUAL';

export interface MaintenancePlan {
  id: string;
  equipmentId: string;
  equipment?: Equipment;
  name: string;
  frequency: Frequency;
  nextDueDate: string;
  lastExecutedDate?: string;
  alertDaysBefore: number;
  estimatedHours?: number;
  checklistTemplate: ChecklistItem[];
  assignedToUserId?: string;
  assignedToProviderId?: string;
  active: boolean;
}

// ─── Helpdesk ─────────────────────────────────────────────────────────────────

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
export type RequestType = 'EQUIPMENT_FAILURE' | 'MAINTENANCE_REQUEST' | 'OTHER';

export interface HelpdeskTicket {
  id: string;
  code: string;
  trackingToken: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone?: string;
  branchId: string;
  branch?: Branch;
  area: string;
  requestType: RequestType;
  priority: Priority;
  description: string;
  attachments: string[];
  status: TicketStatus;
  assignedToId?: string;
  assignedTo?: AuthUser;
  equipmentId?: string;
  equipment?: Equipment;
  slaDeadline?: string;
  resolvedAt?: string;
  closedAt?: string;
  resolutionNotes?: string;
  comments?: TicketComment[];
  createdAt: string;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  authorId?: string;
  authorName: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export interface SparePart {
  id: string;
  code: string;
  name: string;
  description?: string;
  unit: string;
  category?: string;
  providerId?: string;
  active: boolean;
  stocks?: SparePartStock[];
}

export interface SparePartStock {
  id: string;
  sparePartId: string;
  branchId: string;
  branch?: Branch;
  quantity: number;
  minStock: number;
}

// ─── Providers ────────────────────────────────────────────────────────────────

export interface Provider {
  id: string;
  nit?: string;
  name: string;
  contact?: string;
  email?: string;
  phone?: string;
  specialty?: string;
  city?: string;
  active: boolean;
  rating?: number;
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
