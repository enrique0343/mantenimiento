import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { QrCode, Wrench, MapPin, AlertTriangle, ClipboardList, Plus } from 'lucide-react';
import api from '@/lib/api';
import type { Equipment, WorkOrder } from '@/types';
import {
  EQUIPMENT_STATUS_LABEL, WO_STATUS_LABEL, WO_TYPE_LABEL,
  WO_STATUS_COLOR, PRIORITY_COLOR, PRIORITY_LABEL, cn,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/store/auth.store';

const STATUS_VARIANT: Record<string, any> = {
  ACTIVE: 'success', MAINTENANCE: 'warning',
  OUT_OF_SERVICE: 'danger', DECOMMISSIONED: 'secondary',
};

export default function EquipmentAccess() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [activeWO, setActiveWO] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!code) return;
    api.get(`/equipments/code/${code}`)
      .then(({ data }) => {
        setEquipment(data);
        // Buscar OT activa para este equipo
        return api.get(`/work-orders?equipmentId=${data.id}&status=OPEN,IN_PROGRESS&limit=1`);
      })
      .then(({ data }) => {
        if (data.data?.length > 0) setActiveWO(data.data[0]);
      })
      .catch((err) => {
        if (err.response?.status === 404) setNotFound(true);
        else toast.error('Error al cargar el equipo');
      })
      .finally(() => setLoading(false));
  }, [code]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-2">
          <QrCode className="h-10 w-10 mx-auto text-blue-500 animate-pulse" />
          <p className="text-slate-500 text-sm">Validando equipo...</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-3 max-w-sm">
          <AlertTriangle className="h-12 w-12 mx-auto text-orange-400" />
          <h2 className="text-lg font-semibold text-slate-800">Equipo no encontrado</h2>
          <p className="text-slate-500 text-sm">
            El código <span className="font-mono font-bold">{code}</span> no corresponde a ningún equipo registrado.
          </p>
          <Button onClick={() => navigate('/')}>Ir al inicio</Button>
        </div>
      </div>
    );
  }

  if (!equipment) return null;

  const loc = equipment.location;

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-md mx-auto space-y-4 pt-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600">
              <Wrench className="h-7 w-7 text-white" />
            </div>
          </div>
          <h1 className="text-lg font-bold text-slate-800">Acceso de Mantenimiento</h1>
          <p className="text-sm text-slate-500">Hola, {user?.name}</p>
        </div>

        {/* Ficha del equipo */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{equipment.name}</CardTitle>
                <p className="text-xs font-mono text-slate-500 mt-0.5">{equipment.code}</p>
              </div>
              <Badge variant={STATUS_VARIANT[equipment.status] ?? 'secondary'}>
                {EQUIPMENT_STATUS_LABEL[equipment.status]}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {equipment.brand && (
              <div className="flex justify-between">
                <span className="text-slate-500">Marca / Modelo</span>
                <span>{[equipment.brand, equipment.model].filter(Boolean).join(' / ')}</span>
              </div>
            )}
            {equipment.serialNumber && (
              <div className="flex justify-between">
                <span className="text-slate-500">N.º de serie</span>
                <span className="font-mono text-xs">{equipment.serialNumber}</span>
              </div>
            )}
            {loc && (
              <div className="flex items-start justify-between gap-2">
                <span className="text-slate-500 shrink-0 flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />Ubicación
                </span>
                <span className="text-right text-xs text-slate-600">
                  {[loc.branch?.name, loc.building, loc.floor, loc.area].filter(Boolean).join(' › ')}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* OT activa o crear nueva */}
        {activeWO ? (
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-blue-800 flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                Orden de trabajo activa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">OT</span>
                  <span className="font-mono text-xs font-bold">{activeWO.code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tipo</span>
                  <span>{WO_TYPE_LABEL[activeWO.type]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Prioridad</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', PRIORITY_COLOR[activeWO.priority])}>
                    {PRIORITY_LABEL[activeWO.priority]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Estado</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', WO_STATUS_COLOR[activeWO.status])}>
                    {WO_STATUS_LABEL[activeWO.status]}
                  </span>
                </div>
              </div>
              <Button
                className="w-full"
                onClick={() => navigate(`/mantenimiento/${activeWO.id}`)}
              >
                <ClipboardList className="h-4 w-4" />
                Abrir orden de trabajo
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-6 text-center space-y-3">
              <p className="text-sm text-slate-500">
                No hay órdenes de trabajo activas para este equipo
              </p>
              <Button
                variant="outline"
                onClick={() => navigate('/mantenimiento/nuevo', { state: { equipmentId: equipment.id, type: 'CORRECTIVE' } })}
              >
                <Plus className="h-4 w-4" />
                Crear OT correctiva
              </Button>
            </CardContent>
          </Card>
        )}

        <Button variant="ghost" className="w-full text-slate-400" onClick={() => navigate(-1)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
