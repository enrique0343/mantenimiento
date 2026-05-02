import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronLeft, Pencil, QrCode, Download, ClipboardList,
  MapPin, Tag, Calendar, DollarSign, AlertTriangle,
} from 'lucide-react';
import QRCodeLib from 'qrcode';
import api from '@/lib/api';
import type { Equipment, WorkOrder } from '@/types';
import {
  EQUIPMENT_STATUS_LABEL, WO_STATUS_LABEL, WO_TYPE_LABEL, PRIORITY_LABEL,
  PRIORITY_COLOR, WO_STATUS_COLOR, formatDate, formatCurrency, cn,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';

const STATUS_VARIANT: Record<string, any> = {
  ACTIVE: 'success', MAINTENANCE: 'warning',
  OUT_OF_SERVICE: 'danger', DECOMMISSIONED: 'secondary',
};

export default function EquipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [history, setHistory] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrOpen, setQrOpen] = useState(searchParams.get('tab') === 'qr');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get(`/equipments/${id}`),
      api.get(`/equipments/${id}/history`),
    ])
      .then(([eqRes, histRes]) => {
        setEquipment(eqRes.data);
        setHistory(histRes.data);
      })
      .catch(() => toast.error('Error al cargar el equipo'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!qrOpen || !equipment) return;
    QRCodeLib.toDataURL(equipment.qrCode, {
      width: 300, margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then(setQrDataUrl);
  }, [qrOpen, equipment]);

  function openQR() {
    setQrOpen(true);
    setSearchParams({ tab: 'qr' });
  }
  function closeQR() {
    setQrOpen(false);
    setSearchParams({});
  }

  function downloadQR() {
    if (!qrDataUrl || !equipment) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `QR-${equipment.code}.png`;
    a.click();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!equipment) {
    return (
      <div className="text-center py-24 text-slate-400">
        <AlertTriangle className="h-10 w-10 mx-auto mb-2 opacity-40" />
        <p>Equipo no encontrado</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate('/equipos')}>
          Volver a equipos
        </Button>
      </div>
    );
  }

  const loc = equipment.location;

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/equipos')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-800">{equipment.name}</h1>
              <Badge variant={STATUS_VARIANT[equipment.status] ?? 'secondary'}>
                {EQUIPMENT_STATUS_LABEL[equipment.status]}
              </Badge>
              <Badge variant={equipment.type === 'BIOMEDICAL' ? 'info' : 'secondary'}>
                {equipment.type === 'BIOMEDICAL' ? 'Biomédico' : 'General'}
              </Badge>
            </div>
            <p className="text-sm text-slate-500 mt-0.5 font-mono">{equipment.code}</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={openQR}>
            <QrCode className="h-4 w-4" />
            Ver QR
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/equipos/${id}/editar`)}>
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
          <Button size="sm" onClick={() => navigate('/mantenimiento/nuevo', { state: { equipmentId: id } })}>
            <ClipboardList className="h-4 w-4" />
            Nueva OT
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Identificación */}
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Tag className="h-4 w-4" />Identificación</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Código" value={equipment.code} mono />
            <Row label="Nombre" value={equipment.name} />
            <Row label="N.º de serie" value={equipment.serialNumber} />
            <Row label="Marca" value={equipment.brand} />
            <Row label="Modelo" value={equipment.model} />
            <Row label="Año" value={equipment.year?.toString()} />
            <Row label="Categoría" value={equipment.category} />
            <Row label="Subcategoría" value={equipment.subcategory} />
          </CardContent>
        </Card>

        {/* Ubicación */}
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><MapPin className="h-4 w-4" />Ubicación</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Sucursal" value={loc?.branch?.name} />
            <Row label="Edificio" value={loc?.building} />
            <Row label="Piso" value={loc?.floor} />
            <Row label="Área / Servicio" value={loc?.area} />
          </CardContent>
        </Card>

        {/* Activos Fijos */}
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" />Activos Fijos</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="N.º de activo" value={equipment.assetNumber} />
            <Row label="Fecha de compra" value={formatDate(equipment.purchaseDate)} />
            <Row label="Valor de adquisición" value={formatCurrency(equipment.purchaseValue)} />
          </CardContent>
        </Card>

        {/* Notas */}
        {equipment.notes && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Observaciones</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{equipment.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Historial de OTs */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Historial de Órdenes de Trabajo
            <span className="ml-1 text-xs text-slate-400 font-normal">({history.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <p className="px-6 py-8 text-sm text-center text-slate-400">
              Sin órdenes de trabajo registradas
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-xs font-medium text-slate-500 uppercase">
                  <th className="px-4 py-3 text-left">OT</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Prioridad</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Técnico</th>
                  <th className="px-4 py-3 text-left">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.map((wo) => (
                  <tr
                    key={wo.id}
                    onClick={() => navigate(`/mantenimiento/${wo.id}`)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-2 font-mono text-xs">{wo.code}</td>
                    <td className="px-4 py-2">{WO_TYPE_LABEL[wo.type]}</td>
                    <td className="px-4 py-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', PRIORITY_COLOR[wo.priority])}>
                        {PRIORITY_LABEL[wo.priority]}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', WO_STATUS_COLOR[wo.status])}>
                        {WO_STATUS_LABEL[wo.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-500">{(wo as any).technician?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-500">{formatDate(wo.scheduledDate ?? wo.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Modal QR */}
      <Dialog open={qrOpen} onClose={closeQR} title={`Código QR — ${equipment.code}`}
        description={equipment.name}>
        <div className="flex flex-col items-center gap-4">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt={`QR ${equipment.code}`} className="w-64 h-64 rounded border" />
          ) : (
            <div className="w-64 h-64 flex items-center justify-center bg-slate-100 rounded">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          <div className="text-center text-xs text-slate-500 space-y-1">
            <p className="font-mono font-bold text-slate-800">{equipment.code}</p>
            <p className="text-slate-400 break-all">{equipment.qrCode}</p>
          </div>
          <div className="flex gap-2 w-full">
            <Button variant="outline" className="flex-1" onClick={closeQR}>Cerrar</Button>
            <Button className="flex-1" onClick={downloadQR} disabled={!qrDataUrl}>
              <Download className="h-4 w-4" />
              Descargar PNG
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={cn('text-slate-800 text-right', mono && 'font-mono text-xs')}>
        {value ?? '—'}
      </span>
    </div>
  );
}
