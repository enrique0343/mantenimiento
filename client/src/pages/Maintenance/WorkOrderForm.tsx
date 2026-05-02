import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ChevronLeft, Save } from 'lucide-react';
import api from '@/lib/api';
import type { Equipment, AuthUser, Provider, MaintenancePlan } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const schema = z.object({
  type: z.enum(['PREVENTIVE', 'CORRECTIVE', 'PREDICTIVE']),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  equipmentSearch: z.string().min(1, 'Busque y seleccione un equipo'),
  equipmentId: z.string().min(1, 'Seleccione un equipo'),
  technicianId: z.string().optional(),
  providerId: z.string().optional(),
  maintenancePlanId: z.string().optional(),
  scheduledDate: z.string().optional(),
  estimatedHours: z.string().optional(),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export default function WorkOrderForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const presetEquipmentId = location.state?.equipmentId as string | undefined;
  const presetType = location.state?.type as string | undefined;

  const [loading, setLoading] = useState(false);
  const [technicians, setTechnicians] = useState<AuthUser[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [equipmentResults, setEquipmentResults] = useState<Equipment[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);
  const [plans, setPlans] = useState<MaintenancePlan[]>([]);
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: (presetType as any) ?? 'CORRECTIVE',
      priority: 'MEDIUM',
      equipmentId: presetEquipmentId ?? '',
      equipmentSearch: '',
    },
  });

  const woType = watch('type');
  const equipmentSearch = watch('equipmentSearch');

  // Cargar técnicos y proveedores
  useEffect(() => {
    api.get('/users').then(({ data }) => {
      setTechnicians(data.filter((u: AuthUser) => ['TECHNICIAN', 'MAINTENANCE_CHIEF'].includes(u.role)));
    }).catch(() => {});
    api.get('/providers').then(({ data }) => setProviders(data)).catch(() => {});
  }, []);

  // Precargar equipo si viene desde otro contexto
  useEffect(() => {
    if (!presetEquipmentId) return;
    api.get(`/equipments/${presetEquipmentId}`).then(({ data }) => {
      setSelectedEquipment(data);
      setValue('equipmentSearch', data.name);
      setValue('equipmentId', data.id);
    }).catch(() => {});
  }, [presetEquipmentId, setValue]);

  // Buscar equipos en tiempo real
  useEffect(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (!equipmentSearch || equipmentSearch.length < 2 || selectedEquipment) return;

    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/equipments?search=${encodeURIComponent(equipmentSearch)}&limit=8`);
        setEquipmentResults(data.data);
      } catch { /* non-critical */ }
    }, 300);
    setSearchTimeout(t);
    return () => clearTimeout(t);
  }, [equipmentSearch]);

  // Cargar planes si es preventivo y hay equipo seleccionado
  useEffect(() => {
    if (woType !== 'PREVENTIVE' || !selectedEquipment) { setPlans([]); return; }
    api.get(`/maintenance-plans?equipmentId=${selectedEquipment.id}`).then(({ data }) => {
      setPlans(Array.isArray(data) ? data : data.data ?? []);
    }).catch(() => {});
  }, [woType, selectedEquipment]);

  function selectEquipment(eq: Equipment) {
    setSelectedEquipment(eq);
    setValue('equipmentId', eq.id);
    setValue('equipmentSearch', eq.name);
    setEquipmentResults([]);
  }

  function clearEquipment() {
    setSelectedEquipment(null);
    setValue('equipmentId', '');
    setValue('equipmentSearch', '');
    setEquipmentResults([]);
  }

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const payload = {
        type: data.type,
        priority: data.priority,
        equipmentId: data.equipmentId,
        technicianId: data.technicianId || null,
        providerId: data.providerId || null,
        maintenancePlanId: data.maintenancePlanId || null,
        scheduledDate: data.scheduledDate || null,
        estimatedHours: data.estimatedHours ? parseFloat(data.estimatedHours) : null,
        notes: data.notes || null,
      };
      const { data: created } = await api.post('/work-orders', payload);
      toast.success(`OT ${created.code} creada correctamente`);
      navigate(`/mantenimiento/${created.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al crear la OT');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold text-slate-800">Nueva Orden de Trabajo</h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Clasificación */}
        <Card>
          <CardHeader><CardTitle className="text-base">Clasificación</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo *" error={errors.type?.message}>
              <Select
                {...register('type')}
                options={[
                  { value: 'CORRECTIVE', label: 'Correctivo' },
                  { value: 'PREVENTIVE', label: 'Preventivo' },
                  { value: 'PREDICTIVE', label: 'Predictivo' },
                ]}
              />
            </Field>
            <Field label="Prioridad *" error={errors.priority?.message}>
              <Select
                {...register('priority')}
                options={[
                  { value: 'CRITICAL', label: '🔴 Crítica' },
                  { value: 'HIGH', label: '🟠 Alta' },
                  { value: 'MEDIUM', label: '🟡 Media' },
                  { value: 'LOW', label: '🟢 Baja' },
                ]}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Equipo */}
        <Card>
          <CardHeader><CardTitle className="text-base">Equipo *</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Input
                {...register('equipmentSearch')}
                placeholder="Buscar equipo por nombre o código..."
                disabled={!!selectedEquipment}
                autoComplete="off"
              />
              {selectedEquipment && (
                <button
                  type="button"
                  onClick={clearEquipment}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-red-500 px-2 py-1"
                >
                  Cambiar
                </button>
              )}
            </div>
            {errors.equipmentId && (
              <p className="text-xs text-destructive">{errors.equipmentId.message}</p>
            )}
            {/* Resultados de búsqueda */}
            {equipmentResults.length > 0 && !selectedEquipment && (
              <div className="border rounded-md divide-y max-h-48 overflow-y-auto bg-white shadow-sm">
                {equipmentResults.map((eq) => (
                  <button
                    key={eq.id}
                    type="button"
                    onClick={() => selectEquipment(eq)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center justify-between"
                  >
                    <span className="font-medium">{eq.name}</span>
                    <span className="text-xs text-slate-400 font-mono">{eq.code}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Info equipo seleccionado */}
            {selectedEquipment && (
              <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm">
                <p className="font-medium text-blue-800">{selectedEquipment.name}</p>
                <p className="text-xs text-blue-500 font-mono">{selectedEquipment.code}</p>
                {selectedEquipment.location && (
                  <p className="text-xs text-blue-600 mt-0.5">
                    {(selectedEquipment.location as any).branch?.name} ·{' '}
                    {selectedEquipment.location.area}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Plan de mantenimiento (solo preventivo) */}
        {woType === 'PREVENTIVE' && plans.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Plan de mantenimiento</CardTitle></CardHeader>
            <CardContent>
              <Field label="Seleccionar plan (opcional)">
                <Select
                  {...register('maintenancePlanId')}
                  placeholder="Sin plan (checklist vacío)"
                  options={plans.map((p) => ({ value: p.id, label: `${p.name} — ${p.frequency}` }))}
                />
              </Field>
            </CardContent>
          </Card>
        )}

        {/* Asignación y fechas */}
        <Card>
          <CardHeader><CardTitle className="text-base">Asignación y Programación</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Técnico asignado">
              <Select
                {...register('technicianId')}
                placeholder="Sin asignar"
                options={technicians.map((u) => ({ value: u.id, label: u.name }))}
              />
            </Field>
            <Field label="Proveedor externo">
              <Select
                {...register('providerId')}
                placeholder="Sin proveedor"
                options={providers.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field label="Fecha programada">
              <Input {...register('scheduledDate')} type="date" />
            </Field>
            <Field label="Horas estimadas">
              <Input {...register('estimatedHours')} type="number" step="0.5" placeholder="4" min={0} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Observaciones</CardTitle></CardHeader>
          <CardContent>
            <Textarea {...register('notes')} placeholder="Descripción del trabajo, falla reportada, etc." rows={3} />
          </CardContent>
        </Card>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button type="submit" loading={loading}>
            <Save className="h-4 w-4" />
            Crear OT
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
