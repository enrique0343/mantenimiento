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
  white: '#ffffff',
  green: '#16a34a',
  greenBg: '#dcfce7',
  red: '#dc2626',
  redBg: '#fee2e2',
  purple: '#7c3aed',
  purpleBg: '#ede9fe',
};

const TYPE_COLOR: Record<string, string> = { PREVENTIVE: C.green, CORRECTIVE: C.red, PREDICTIVE: C.purple };
const TYPE_BG: Record<string, string> = { PREVENTIVE: C.greenBg, CORRECTIVE: C.redBg, PREDICTIVE: C.purpleBg };
const TYPE_LABEL: Record<string, string> = { PREVENTIVE: 'Preventivo', CORRECTIVE: 'Correctivo', PREDICTIVE: 'Predictivo' };
const STATUS_LABEL: Record<string, string> = { OPEN: 'Abierto', IN_PROGRESS: 'En progreso', COMPLETED: 'Completado', VERIFIED: 'Verificado', CLOSED: 'Cerrado' };

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: C.text, backgroundColor: C.white },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 10, borderBottom: 2, borderColor: C.primary },
  headerLogo: { width: 60, height: 30, objectFit: 'contain', marginBottom: 4 },
  headerTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.primary },
  headerSub: { fontSize: 9, color: C.muted, marginTop: 2 },
  headerRight: { alignItems: 'flex-end' },
  headerCode: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.text },
  // Equipment card
  equipCard: { backgroundColor: C.primaryLight, borderRadius: 4, padding: 10, marginBottom: 14, flexDirection: 'row', gap: 12 },
  equipCol: { flex: 1 },
  equipLabel: { fontSize: 7, color: C.primary, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', marginBottom: 1 },
  equipValue: { fontSize: 9, color: C.text, marginBottom: 4 },
  // Summary boxes
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  summaryBox: { flex: 1, borderRadius: 4, padding: 8, alignItems: 'center', border: 1, borderColor: C.border },
  summaryNum: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.primary },
  summaryLabel: { fontSize: 7, color: C.muted, textAlign: 'center', marginTop: 2 },
  // Section
  sectionTitle: { backgroundColor: C.primaryLight, color: C.primary, fontFamily: 'Helvetica-Bold', fontSize: 8, paddingVertical: 3, paddingHorizontal: 6, marginBottom: 6, borderRadius: 2 },
  // Table
  table: { border: 1, borderColor: C.border, borderRadius: 3, overflow: 'hidden', marginBottom: 10 },
  tableHeader: { flexDirection: 'row', backgroundColor: C.bg },
  tableRow: { flexDirection: 'row', borderTop: 1, borderColor: C.border },
  th: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.muted, padding: 4, textTransform: 'uppercase' },
  td: { fontSize: 8, padding: 4 },
  badge: { fontSize: 7, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  // Footer
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderTop: 1, borderColor: C.border, paddingTop: 4 },
  footerText: { fontSize: 7, color: C.muted },
});

function fmt(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

interface WO {
  id: string; code: string; type: string; status: string;
  scheduledDate?: string; completedAt?: string;
  laborHours?: number; estimatedHours?: number;
  technician?: { name: string }; provider?: { name: string };
  notes?: string;
}

interface Equipment {
  name: string; code: string; brand?: string; model?: string;
  serialNumber?: string; type: string; status: string;
  location?: { area: string; branch?: { name: string } };
  category?: string;
}

interface Props {
  equipment: Equipment;
  workOrders: WO[];
  company?: { name: string; nit?: string; logoUrl?: string };
  from?: string;
  to?: string;
}

export function EquipmentReportPDF({ equipment, workOrders, company, from, to }: Props) {
  const now = new Date().toLocaleString('es-CO');
  const eq = equipment;
  const total = workOrders.length;
  const byType = {
    PREVENTIVE: workOrders.filter(w => w.type === 'PREVENTIVE').length,
    CORRECTIVE: workOrders.filter(w => w.type === 'CORRECTIVE').length,
    PREDICTIVE: workOrders.filter(w => w.type === 'PREDICTIVE').length,
  };
  const completed = workOrders.filter(w => ['COMPLETED', 'VERIFIED', 'CLOSED'].includes(w.status)).length;
  const totalLabor = workOrders.reduce((sum, w) => sum + (w.laborHours ? Number(w.laborHours) : 0), 0);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header} fixed>
          <View>
            {company?.logoUrl && <Image src={company.logoUrl} style={s.headerLogo} />}
            <Text style={s.headerTitle}>{company?.name ?? 'Gestión de Mantenimiento'}</Text>
            {company?.nit && <Text style={s.headerSub}>NIT: {company.nit}</Text>}
            <Text style={s.headerSub}>Bitácora de Mantenimiento</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.headerCode}>{eq.code}</Text>
            <Text style={{ ...s.headerSub, marginTop: 2 }}>Emitido: {now}</Text>
            {from && to && (
              <Text style={s.headerSub}>Período: {fmt(from)} – {fmt(to)}</Text>
            )}
          </View>
        </View>

        {/* Equipment card */}
        <View style={s.equipCard} wrap={false}>
          <View style={s.equipCol}>
            <Text style={s.equipLabel}>Equipo</Text>
            <Text style={{ ...s.equipValue, fontSize: 12, fontFamily: 'Helvetica-Bold' }}>{eq.name}</Text>
            <Text style={s.equipLabel}>Tipo</Text>
            <Text style={s.equipValue}>{eq.type === 'BIOMEDICAL' ? 'Biomédico' : 'General'} · {eq.category ?? '—'}</Text>
          </View>
          <View style={s.equipCol}>
            <Text style={s.equipLabel}>Marca / Modelo</Text>
            <Text style={s.equipValue}>{[eq.brand, eq.model].filter(Boolean).join(' / ') || '—'}</Text>
            <Text style={s.equipLabel}>Serie</Text>
            <Text style={s.equipValue}>{eq.serialNumber ?? '—'}</Text>
          </View>
          <View style={s.equipCol}>
            <Text style={s.equipLabel}>Sucursal</Text>
            <Text style={s.equipValue}>{eq.location?.branch?.name ?? '—'}</Text>
            <Text style={s.equipLabel}>Área</Text>
            <Text style={s.equipValue}>{eq.location?.area ?? '—'}</Text>
          </View>
        </View>

        {/* Summary */}
        <View style={s.summaryRow} wrap={false}>
          <View style={s.summaryBox}>
            <Text style={s.summaryNum}>{total}</Text>
            <Text style={s.summaryLabel}>Total OTs</Text>
          </View>
          <View style={{ ...s.summaryBox, borderColor: C.green }}>
            <Text style={{ ...s.summaryNum, color: C.green }}>{byType.PREVENTIVE}</Text>
            <Text style={s.summaryLabel}>Preventivos</Text>
          </View>
          <View style={{ ...s.summaryBox, borderColor: C.red }}>
            <Text style={{ ...s.summaryNum, color: C.red }}>{byType.CORRECTIVE}</Text>
            <Text style={s.summaryLabel}>Correctivos</Text>
          </View>
          <View style={{ ...s.summaryBox, borderColor: C.purple }}>
            <Text style={{ ...s.summaryNum, color: C.purple }}>{byType.PREDICTIVE}</Text>
            <Text style={s.summaryLabel}>Predictivos</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={{ ...s.summaryNum, fontSize: 16 }}>{completed}</Text>
            <Text style={s.summaryLabel}>Completados</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={{ ...s.summaryNum, fontSize: 16 }}>{totalLabor > 0 ? `${Math.round(totalLabor * 10) / 10}h` : '—'}</Text>
            <Text style={s.summaryLabel}>Horas totales</Text>
          </View>
        </View>

        {/* Work orders table */}
        <Text style={s.sectionTitle}>Historial de Órdenes de Trabajo ({total})</Text>
        {workOrders.length === 0 ? (
          <View style={{ padding: 12, border: 1, borderColor: C.border, borderRadius: 3 }}>
            <Text style={{ fontSize: 9, color: C.muted, textAlign: 'center' }}>Sin órdenes de trabajo en el período seleccionado</Text>
          </View>
        ) : (
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={{ ...s.th, width: 80 }}>Código</Text>
              <Text style={{ ...s.th, width: 70 }}>Tipo</Text>
              <Text style={{ ...s.th, width: 70 }}>Estado</Text>
              <Text style={{ ...s.th, width: 60 }}>Programado</Text>
              <Text style={{ ...s.th, width: 60 }}>Cierre</Text>
              <Text style={{ ...s.th, width: 50 }}>Horas</Text>
              <Text style={{ ...s.th, flex: 1 }}>Técnico</Text>
            </View>
            {workOrders.map((wo, i) => (
              <View key={wo.id} style={{ ...s.tableRow, backgroundColor: i % 2 === 0 ? C.white : C.bg }} wrap={false}>
                <Text style={{ ...s.td, width: 80, fontFamily: 'Helvetica-Bold' }}>{wo.code}</Text>
                <Text style={{ ...s.td, width: 70 }}>
                  <Text style={{ color: TYPE_COLOR[wo.type] }}>{TYPE_LABEL[wo.type] ?? wo.type}</Text>
                </Text>
                <Text style={{ ...s.td, width: 70, color: STATUS_LABEL[wo.status] === 'Completado' ? C.green : C.muted }}>
                  {STATUS_LABEL[wo.status] ?? wo.status}
                </Text>
                <Text style={{ ...s.td, width: 60 }}>{fmt(wo.scheduledDate)}</Text>
                <Text style={{ ...s.td, width: 60 }}>{fmt(wo.completedAt)}</Text>
                <Text style={{ ...s.td, width: 50, textAlign: 'center' }}>
                  {wo.laborHours ? `${wo.laborHours}h` : (wo.estimatedHours ? `~${wo.estimatedHours}h` : '—')}
                </Text>
                <Text style={{ ...s.td, flex: 1 }}>{wo.technician?.name ?? wo.provider?.name ?? '—'}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Bitácora: {eq.name} ({eq.code})</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Página ${pageNumber} / ${totalPages}`} />
          <Text style={s.footerText}>{now}</Text>
        </View>
      </Page>
    </Document>
  );
}
