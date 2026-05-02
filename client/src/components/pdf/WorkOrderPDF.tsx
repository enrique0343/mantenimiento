import {
  Document, Page, View, Text, Image, StyleSheet,
} from '@react-pdf/renderer';

const C = {
  primary: '#1e40af',
  primaryLight: '#dbeafe',
  text: '#1e293b',
  muted: '#64748b',
  border: '#e2e8f0',
  bg: '#f8fafc',
  ok: '#16a34a',
  fail: '#dc2626',
  na: '#94a3b8',
  white: '#ffffff',
};

const s = StyleSheet.create({
  page: { padding: 36, paddingBottom: 52, fontSize: 9, fontFamily: 'Helvetica', color: C.text, backgroundColor: C.white },
  // ── Header ────────────────────────────────────────────────────────────────
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 10, borderBottom: 1, borderColor: C.primary },
  headerLogo: { width: 60, height: 30, objectFit: 'contain' },
  headerLeft: { flex: 1 },
  headerTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.primary },
  headerSub: { fontSize: 9, color: C.muted, marginTop: 2 },
  headerRight: { alignItems: 'flex-end' },
  headerCode: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.primary },
  headerDate: { fontSize: 8, color: C.muted, marginTop: 2 },
  // ── Section ───────────────────────────────────────────────────────────────
  section: { marginBottom: 10 },
  sectionTitle: { backgroundColor: C.primaryLight, color: C.primary, fontFamily: 'Helvetica-Bold', fontSize: 8, paddingVertical: 3, paddingHorizontal: 6, marginBottom: 6, borderRadius: 2 },
  // ── Grid / table ──────────────────────────────────────────────────────────
  row2: { flexDirection: 'row', gap: 8 },
  col: { flex: 1 },
  fieldGroup: { marginBottom: 4 },
  label: { fontSize: 7, color: C.muted, marginBottom: 1, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
  value: { fontSize: 9, color: C.text },
  // ── Table ─────────────────────────────────────────────────────────────────
  table: { border: 1, borderColor: C.border, borderRadius: 3, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: C.bg },
  tableRow: { flexDirection: 'row', borderTop: 1, borderColor: C.border },
  th: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.muted, padding: 4, textTransform: 'uppercase' },
  td: { fontSize: 8, color: C.text, padding: 4 },
  // ── Checklist ─────────────────────────────────────────────────────────────
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 6, borderBottom: 1, borderColor: C.border },
  checkBadge: { fontSize: 7, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3, fontFamily: 'Helvetica-Bold', marginRight: 6, minWidth: 28, textAlign: 'center' },
  checkLabel: { flex: 1, fontSize: 8 },
  // ── Images ────────────────────────────────────────────────────────────────
  imageGrid: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  imageBox: { width: '48%', aspectRatio: '4/3', backgroundColor: C.bg, border: 1, borderColor: C.border, borderRadius: 3, overflow: 'hidden' },
  imageItem: { width: '100%', height: 120, objectFit: 'cover' },
  imageCaption: { fontSize: 7, color: C.muted, textAlign: 'center', paddingVertical: 2 },
  // ── Signature ─────────────────────────────────────────────────────────────
  sigBox: { flex: 1, border: 1, borderColor: C.border, borderRadius: 3, padding: 6, alignItems: 'center' },
  sigImg: { width: 120, height: 56, objectFit: 'contain', marginBottom: 4 },
  sigName: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.text },
  sigRole: { fontSize: 7, color: C.muted },
  // ── Footer ────────────────────────────────────────────────────────────────
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderTop: 1, borderColor: C.border, paddingTop: 4 },
  footerText: { fontSize: 7, color: C.muted },
});

const PRIORITY_LABEL: Record<string, string> = { CRITICAL: 'Crítica', HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja' };
const TYPE_LABEL: Record<string, string> = { PREVENTIVE: 'Preventivo', CORRECTIVE: 'Correctivo', PREDICTIVE: 'Predictivo' };
const STATUS_LABEL: Record<string, string> = { OPEN: 'Abierto', IN_PROGRESS: 'En progreso', COMPLETED: 'Completado', VERIFIED: 'Verificado', CLOSED: 'Cerrado' };

function fmt(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function fmtDt(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface ChecklistItem { id: string; label: string; status?: 'OK' | 'FAIL' | 'NA'; notes?: string; }
interface WOSparePart { sparePart: { code: string; name: string; unit: string }; quantity: number; }
interface WorkOrderData {
  id: string; code: string; type: string; priority: string; status: string;
  scheduledDate?: string; startedAt?: string; completedAt?: string;
  estimatedHours?: number; laborHours?: number; notes?: string;
  beforeImages: string[]; afterImages: string[];
  techSignature?: string; clientSignature?: string;
  signerName?: string; signerRole?: string;
  checklist?: ChecklistItem[];
  equipment: {
    name: string; code: string; brand?: string; model?: string; serialNumber?: string;
    type: string; location?: { area: string; branch?: { name: string } };
  };
  technician?: { name: string };
  provider?: { name: string };
  spareParts: WOSparePart[];
}

interface CompanyInfo { name: string; nit?: string; logoUrl?: string; }

interface Props { workOrder: WorkOrderData; company?: CompanyInfo; }

const checkColor: Record<string, string> = { OK: C.ok, FAIL: C.fail, NA: C.na };
const checkBg: Record<string, string> = { OK: '#dcfce7', FAIL: '#fee2e2', NA: '#f1f5f9' };

export function WorkOrderPDF({ workOrder: wo, company }: Props) {
  const checklist: ChecklistItem[] = Array.isArray(wo.checklist) ? wo.checklist : [];
  const spareParts: WOSparePart[] = Array.isArray(wo.spareParts) ? wo.spareParts : [];
  const now = new Date().toLocaleString('es-CO');

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header} fixed>
          <View style={s.headerLeft}>
            {company?.logoUrl && (
              <Image src={company.logoUrl} style={s.headerLogo} />
            )}
            <Text style={s.headerTitle}>{company?.name ?? 'Gestión de Mantenimiento'}</Text>
            {company?.nit && <Text style={s.headerSub}>NIT: {company.nit}</Text>}
            <Text style={s.headerSub}>Orden de Trabajo</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.headerCode}>{wo.code}</Text>
            <Text style={s.headerDate}>Emitido: {now}</Text>
            <Text style={{ ...s.headerDate, marginTop: 4, fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.primary }}>
              {TYPE_LABEL[wo.type] ?? wo.type} · {PRIORITY_LABEL[wo.priority] ?? wo.priority}
            </Text>
          </View>
        </View>

        {/* Equipment */}
        <View style={s.section} wrap={false}>
          <Text style={s.sectionTitle}>Ficha del Equipo</Text>
          <View style={s.row2}>
            <View style={s.col}>
              <Field label="Nombre" value={wo.equipment.name} />
              <Field label="Código" value={wo.equipment.code} />
              <Field label="Marca / Modelo" value={[wo.equipment.brand, wo.equipment.model].filter(Boolean).join(' / ') || '—'} />
            </View>
            <View style={s.col}>
              <Field label="Número de serie" value={wo.equipment.serialNumber ?? '—'} />
              <Field label="Sucursal" value={wo.equipment.location?.branch?.name ?? '—'} />
              <Field label="Área" value={wo.equipment.location?.area ?? '—'} />
            </View>
          </View>
        </View>

        {/* OT data */}
        <View style={s.section} wrap={false}>
          <Text style={s.sectionTitle}>Datos de la Orden de Trabajo</Text>
          <View style={s.row2}>
            <View style={s.col}>
              <Field label="Estado" value={STATUS_LABEL[wo.status] ?? wo.status} />
              <Field label="Técnico" value={wo.technician?.name ?? wo.provider?.name ?? '—'} />
            </View>
            <View style={s.col}>
              <Field label="Fecha programada" value={fmt(wo.scheduledDate)} />
              <Field label="Inicio real" value={fmtDt(wo.startedAt)} />
            </View>
            <View style={s.col}>
              <Field label="Fecha cierre" value={fmtDt(wo.completedAt)} />
              <Field label="Horas trabajadas" value={wo.laborHours ? `${wo.laborHours}h` : (wo.estimatedHours ? `${wo.estimatedHours}h (estimadas)` : '—')} />
            </View>
          </View>
        </View>

        {/* Checklist */}
        {checklist.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Checklist de Ejecución</Text>
            <View style={s.table}>
              {checklist.map((item, i) => {
                const status = item.status ?? 'NA';
                return (
                  <View key={item.id ?? i} style={{ ...s.checkRow, backgroundColor: i % 2 === 0 ? C.white : C.bg }}>
                    <Text style={{ ...s.checkBadge, color: checkColor[status], backgroundColor: checkBg[status] }}>
                      {status}
                    </Text>
                    <Text style={s.checkLabel}>{item.label}</Text>
                    {item.notes && <Text style={{ fontSize: 7, color: C.muted, maxWidth: 120 }}>{item.notes}</Text>}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Spare parts */}
        {spareParts.length > 0 && (
          <View style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>Repuestos Utilizados</Text>
            <View style={s.table}>
              <View style={s.tableHeader}>
                <Text style={{ ...s.th, width: 70 }}>Código</Text>
                <Text style={{ ...s.th, flex: 1 }}>Descripción</Text>
                <Text style={{ ...s.th, width: 50 }}>Cantidad</Text>
                <Text style={{ ...s.th, width: 50 }}>Unidad</Text>
              </View>
              {spareParts.map((sp, i) => (
                <View key={i} style={{ ...s.tableRow, backgroundColor: i % 2 === 0 ? C.white : C.bg }}>
                  <Text style={{ ...s.td, width: 70, fontFamily: 'Helvetica-Bold' }}>{sp.sparePart.code}</Text>
                  <Text style={{ ...s.td, flex: 1 }}>{sp.sparePart.name}</Text>
                  <Text style={{ ...s.td, width: 50, textAlign: 'center' }}>{sp.quantity}</Text>
                  <Text style={{ ...s.td, width: 50 }}>{sp.sparePart.unit}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Images — BEFORE */}
        {wo.beforeImages.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Registro Fotográfico — Antes</Text>
            <View style={s.imageGrid}>
              {wo.beforeImages.map((url, i) => (
                <View key={i} style={s.imageBox} wrap={false}>
                  <Image src={url} style={s.imageItem} />
                  <Text style={s.imageCaption}>Antes {i + 1}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Images — AFTER */}
        {wo.afterImages.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Registro Fotográfico — Después</Text>
            <View style={s.imageGrid}>
              {wo.afterImages.map((url, i) => (
                <View key={i} style={s.imageBox} wrap={false}>
                  <Image src={url} style={s.imageItem} />
                  <Text style={s.imageCaption}>Después {i + 1}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Notes */}
        {wo.notes && (
          <View style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>Observaciones</Text>
            <View style={{ padding: 6, backgroundColor: C.bg, borderRadius: 3, border: 1, borderColor: C.border }}>
              <Text style={{ fontSize: 9, color: C.text, lineHeight: 1.5 }}>{wo.notes}</Text>
            </View>
          </View>
        )}

        {/* Signatures */}
        {(wo.techSignature || wo.clientSignature) && (
          <View style={{ ...s.section, ...s.row2 }} wrap={false}>
            {wo.techSignature && (
              <View style={s.sigBox}>
                <Text style={{ ...s.label, marginBottom: 6 }}>FIRMA TÉCNICO</Text>
                <Image src={wo.techSignature} style={s.sigImg} />
                <Text style={s.sigName}>{wo.technician?.name ?? '—'}</Text>
                <Text style={s.sigRole}>Técnico ejecutor</Text>
              </View>
            )}
            {wo.clientSignature && (
              <View style={s.sigBox}>
                <Text style={{ ...s.label, marginBottom: 6 }}>FIRMA RECEPTOR</Text>
                <Image src={wo.clientSignature} style={s.sigImg} />
                <Text style={s.sigName}>{wo.signerName ?? '—'}</Text>
                <Text style={s.sigRole}>{wo.signerRole ?? 'Receptor'}</Text>
              </View>
            )}
          </View>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{wo.code} · {company?.name ?? 'Gestión de Mantenimiento'}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Página ${pageNumber} / ${totalPages}`} />
          <Text style={s.footerText}>{now}</Text>
        </View>
      </Page>
    </Document>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.fieldGroup}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}
