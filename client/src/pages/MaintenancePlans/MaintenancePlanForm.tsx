import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ChevronLeft, Save, Plus, Trash2, GripVertical, Search } from 'lucide-react';
import api from '@/lib/api';
import type { Equipment, AuthUser, Provider } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const checklistItemSchema = z.object({
  id: z.string(),
  label: z.string().min(1, 'Requerido'),
  required: z.boolean().default(true),
});

const schema = z.object({
  name: z.string().min(2, 'Nombre requerido'),
  equipmentSearch: z.string().min(1, 'Busque y seleccione un equipo'),
  equipmentId: z.string().min(1, 'Seleccione un equipo'),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL']),
  nextDueDate: z.string().min(1, 'Fecha requerida'),
  alertDaysBefore: z.string().optional(),
  estimatedHours: z.string().optional(),
  assignedToUserId: z.string().optional(),
  assignedToProviderId: z.string().optional(),
  checklistItems: z.array(checklistItemSchema),
});
type FormData = z.infer<typeof schema>;

export default function MaintenancePlanForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(isEdit);
  const [technicians, setTechnicians] = useState<AuthUser[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [equipmentResults, setEquipmentResults] = useState<Equipment[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  const { register, handleSubmit, watch, setValue, control, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      frequency: 'MONTHLY',
      alertDaysBefore: '7',
      equipmentSearch: '',
      equipmentId: '',
      checklistItems: [],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'checklistItems' });
  const equipmentSearch = watch('equipmentSearch');

  useEffect(() => {
    api.get('/users').then(({ data }) =>
      setTechnicians(data.filter((u: AuthUser) => ['TECHNICIAN', 'MAINTENANCE_CHIEF'].includes(u.role)))
    ).catch(() => {});
    api.get('/providers').then(({ data }) => setProviders(data)).catch(() => {});
  }, []);

  // Load existing plan for edit
  useEffect(() => {
    if (!isEdit || !id) return;
    api.get(`/maintenance-plans/${id}`).then(({ data }) => {
      setValue('name', data.name);
      setValue('frequency', data.frequency);
      setValue('nextDueDate', data.nextDueDate?.split('T')[0] ?? '');
      setValue('alertDaysBefore', String(data.alertDaysBefore ?? 7));
      setValue('estimatedHours', data.estimatedHours ? String(data.estimatedHours) : '');
      setValue('assignedToUserId', data.assignedToUserId ?? '');
      setValue('assignedToProviderId', data.assignedToProviderId ?? '');
      if (data.equipment) {
        setSelectedEquipment(data.equipment);
        setValue('equipmentId', data.equipment.id);
        setValue('equipmentSearch', data.equipment.name);
      }
      const items = Array.isArray(data.checklistTemplate) ? data.checklistTemplate : [];
      setValue('checklistItems', items.map((item: any) => ({
        id: item.id ?? String(Math.random()),
        label: item.label ?? '',
        required: item.required ?? true,
      })));
    }).catch(() => {
      toast.error('No se pudo cargar el plan');
    }).finally(() => setInitLoading(false));
  }, [id, isEdit, setValue]);

  // Equipment search debounce
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

  function addChecklistItem() {
    append({ id: `item-${Date.now()}`, label: '', required: true });
  }

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const payload = {
        equipmentId: data.equipmentId,
        name: data.name,
        frequency: data.frequency,
        nextDueDate: data.nextDueDate,
        alertDaysBefore: data.alertDaysBefore ? parseInt(data.alertDaysBefore) : 7,
        estimatedHours: data.estimatedHours ? parseFloat(data.estimatedHours) : null,
        assignedToUserId: data.assignedToUserId || null,
        assignedToProviderId: data.assignedToProviderId || null,
        checklistTemplate: data.checklistItems.map((item) => ({
          id: item.id,
          label: item.label,
          required: item.required,
        })),
      };

      if (isEdit) {
        await api.put(`/maintenance-plans/${id}`, payload);
        toast.success('Plan actualizado');
      } else {
        await api.post('/maintenance-plans', payload);
        toast.success('Plan creado correctamente');
      }
      navigate('/planes');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al guardar el plan');
    } finally {
      setLoading(false);
    }
  }

  if (initLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/planes')}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold text-slate-800">
          {isEdit ? 'Editar plan' : 'Nuevo plan de mantenimiento'}
        </h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Basic info */}
        <Card>
          <CardHeader><CardTitle className="text-base">Información del plan</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nombre del plan *</Label>
              <Input {...register('name')} placeholder="Ej. Mantenimiento preventivo mensual" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            {/* Equipment search */}
            <div className="space-y-1.5">
              <Label>Equipo *</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  {...register('equipmentSearch')}
                  placeholder="Buscar equipo por nombre o código..."
                  className="pl-9"
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
              {errors.equipmentId && <p className="text-xs text-destructive">{errors.equipmentId.message}</p>}
              {equipmentResults.length > 0 && !selectedEquipment && (
                <div className="border rounded-md divide-y max-h-40 overflow-y-auto bg-white shadow-sm">
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
              {selectedEquipment && (
                <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm">
                  <p className="font-medium text-blue-800">{selectedEquipment.name}</p>
                  <p className="text-xs text-blue-500 font-mono">{selectedEquipment.code}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Schedule */}
        <Card>
          <CardHeader><CardTitle className="text-base">Programación</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Frecuencia *</Label>
              <Select
                {...register('frequency')}
                options={[
                  { value: 'DAILY', label: 'Diaria' },
                  { value: 'WEEKLY', label: 'Semanal' },
                  { value: 'MONTHLY', label: 'Mensual' },
                  { value: 'QUARTERLY', label: 'Trimestral' },
                  { value: 'BIANNUAL', label: 'Semestral' },
                  { value: 'ANNUAL', label: 'Anual' },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Próxima fecha *</Label>
              <Input {...register('nextDueDate')} type="date" />
              {errors.nextDueDate && <p className="text-xs text-destructive">{errors.nextDueDate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Alertar con (días de antelación)</Label>
              <Input {...register('alertDaysBefore')} type="number" min={1} max={60} placeholder="7" />
            </div>
            <div className="space-y-1.5">
              <Label>Horas estimadas</Label>
              <Input {...register('estimatedHours')} type="number" step="0.5" min={0} placeholder="2" />
            </div>
          </CardContent>
        </Card>

        {/* Assignment */}
        <Card>
          <CardHeader><CardTitle className="text-base">Asignación</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Técnico interno</Label>
              <Select
                {...register('assignedToUserId')}
                placeholder="Sin asignar"
                options={technicians.map((u) => ({ value: u.id, label: u.name }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Proveedor externo</Label>
              <Select
                {...register('assignedToProviderId')}
                placeholder="Sin proveedor"
                options={providers.map((p) => ({ value: p.id, label: p.name }))}
              />
            </div>
          </CardContent>
        </Card>

        {/* Checklist template */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Checklist del plan</CardTitle>
              <Button type="button" size="sm" variant="outline" onClick={addChecklistItem}>
                <Plus className="h-3.5 w-3.5" />
                Agregar ítem
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {fields.length === 0 ? (
              <div className="py-8 text-center text-slate-400 border-2 border-dashed rounded-lg">
                <p className="text-sm">Sin ítems de checklist</p>
                <p className="text-xs mt-1">Agregue las tareas que el técnico debe verificar</p>
                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={addChecklistItem}>
                  <Plus className="h-3.5 w-3.5" />
                  Agregar primer ítem
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {fields.map((field, index) => (
                  <div key={field.id} className="flex items-center gap-2 group">
                    <GripVertical className="h-4 w-4 text-slate-300 shrink-0" />
                    <Input
                      {...register(`checklistItems.${index}.label`)}
                      placeholder={`Ítem ${index + 1}...`}
                      className="flex-1"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-slate-500 whitespace-nowrap cursor-pointer">
                      <input
                        type="checkbox"
                        {...register(`checklistItems.${index}.required`)}
                        className="rounded"
                      />
                      Obligatorio
                    </label>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {errors.checklistItems && (
                  <p className="text-xs text-destructive">Revise los ítems del checklist</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={() => navigate('/planes')}>Cancelar</Button>
          <Button type="submit" loading={loading}>
            <Save className="h-4 w-4" />
            {isEdit ? 'Guardar cambios' : 'Crear plan'}
          </Button>
        </div>
      </form>
    </div>
  );
}
