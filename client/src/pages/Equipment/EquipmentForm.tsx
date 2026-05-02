import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ChevronLeft, Save, Calendar, Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import type { Branch, Location } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ChecklistTemplate { id: string; name: string; category?: string; items: any[]; }
interface ChecklistItem { id: string; item: string; required: boolean; }

const schema = z.object({
  code: z.string().min(1, 'El código es requerido'),
  name: z.string().min(1, 'El nombre es requerido'),
  type: z.enum(['GENERAL', 'BIOMEDICAL']),
  category: z.string().min(1, 'La categoría es requerida'),
  subcategory: z.string().optional(),
  serialNumber: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  year: z.string().optional(),
  branchId: z.string().min(1, 'Seleccione una sucursal'),
  locationId: z.string().min(1, 'Seleccione una ubicación'),
  purchaseDate: z.string().optional(),
  purchaseValueUsd: z.string().optional(),
  slaResponseHours: z.string().optional(),
  slaResolutionHours: z.string().optional(),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'DECOMMISSIONED']).default('ACTIVE'),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

const FREQ_OPTIONS = [
  { value: 'DAILY', label: 'Diario' },
  { value: 'WEEKLY', label: 'Semanal' },
  { value: 'MONTHLY', label: 'Mensual (cada 30 días)' },
  { value: 'QUARTERLY', label: 'Trimestral (cada 90 días)' },
  { value: 'BIANNUAL', label: 'Semestral (cada 6 meses)' },
  { value: 'ANNUAL', label: 'Anual' },
];

export default function EquipmentForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([]);

  // Maintenance plan state
  const [withPlan, setWithPlan] = useState(false);
  const [planName, setPlanName] = useState('');
  const [planFrequency, setPlanFrequency] = useState('MONTHLY');
  const [planStartDate, setPlanStartDate] = useState('');
  const [planEstimatedHours, setPlanEstimatedHours] = useState('');
  const [planTemplateId, setPlanTemplateId] = useState('');
  const [planCustomItems, setPlanCustomItems] = useState<ChecklistItem[]>([]);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [technicians, setTechnicians] = useState<{ id: string; name: string }[]>([]);
  const [planTechnicianId, setPlanTechnicianId] = useState('');

  const {
    register, handleSubmit, watch, setValue, reset,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const selectedBranch = watch('branchId');

  useEffect(() => {
    api.get('/branches').then(({ data }) => setBranches(data)).catch(() => {});
    api.get('/checklist-templates').then(({ data }) => setChecklistTemplates(data)).catch(() => {});
    api.get('/users').then(({ data }) => {
      const techs = (data.data ?? data).filter((u: any) => u.role === 'TECHNICIAN' || u.role === 'MAINTENANCE_CHIEF');
      setTechnicians(techs);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedBranch) { setLocations([]); return; }
    const branch = branches.find((b) => b.id === selectedBranch);
    setLocations(branch?.locations ?? []);
    setValue('locationId', '');
  }, [selectedBranch, branches, setValue]);

  useEffect(() => {
    if (!isEdit || !id) return;
    api.get(`/equipments/${id}`).then(({ data }) => {
      reset({
        code: data.code,
        name: data.name,
        type: data.type,
        category: data.category,
        subcategory: data.subcategory ?? '',
        serialNumber: data.serialNumber ?? '',
        brand: data.brand ?? '',
        model: data.model ?? '',
        year: data.year ? String(data.year) : '',
        branchId: data.location?.branch?.id ?? '',
        locationId: data.locationId,
        purchaseDate: data.purchaseDate ? data.purchaseDate.substring(0, 10) : '',
        purchaseValueUsd: data.purchaseValueUsd ? String(data.purchaseValueUsd) : '',
        slaResponseHours: data.slaResponseHours ? String(data.slaResponseHours) : '',
        slaResolutionHours: data.slaResolutionHours ? String(data.slaResolutionHours) : '',
        status: data.status,
        notes: data.notes ?? '',
      });
    }).catch(() => toast.error('No se pudo cargar el equipo'));
  }, [id, isEdit, reset]);

  function addCheckItem() {
    const text = newCheckItem.trim();
    if (!text) return;
    setPlanCustomItems(prev => [...prev, { id: Date.now().toString(), item: text, required: true }]);
    setNewCheckItem('');
  }

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const payload: any = {
        code: data.code,
        name: data.name,
        type: data.type,
        category: data.category,
        subcategory: data.subcategory || null,
        serialNumber: data.serialNumber || null,
        brand: data.brand || null,
        model: data.model || null,
        year: data.year ? parseInt(data.year) : null,
        locationId: data.locationId,
        purchaseDate: data.purchaseDate || null,
        purchaseValueUsd: data.purchaseValueUsd ? parseFloat(data.purchaseValueUsd) : null,
        slaResponseHours: data.slaResponseHours ? parseInt(data.slaResponseHours) : null,
        slaResolutionHours: data.slaResolutionHours ? parseInt(data.slaResolutionHours) : null,
        status: data.status,
        notes: data.notes || null,
      };

      if (!isEdit && withPlan) {
        if (!planName.trim()) { toast.error('El nombre del plan es requerido'); setLoading(false); return; }
        if (!planStartDate) { toast.error('La fecha de inicio del plan es requerida'); setLoading(false); return; }

        const checklist = planTemplateId
          ? []
          : planCustomItems;

        payload.maintenancePlan = {
          name: planName.trim(),
          frequency: planFrequency,
          startDate: planStartDate,
          estimatedHours: planEstimatedHours ? parseFloat(planEstimatedHours) : undefined,
          checklistTemplateId: planTemplateId || undefined,
          checklistTemplate: checklist,
          assignedToUserId: planTechnicianId || undefined,
        };
      }

      if (isEdit) {
        await api.put(`/equipments/${id}`, payload);
        toast.success('Equipo actualizado');
        navigate(`/equipos/${id}`);
      } else {
        const { data: created } = await api.post('/equipments', payload);
        toast.success('Equipo creado' + (withPlan ? ' con plan de mantenimiento' : ''));
        navigate(`/equipos/${created.id}`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al guardar el equipo');
    } finally {
      setLoading(false);
    }
  }

  const selectedTemplate = checklistTemplates.find(t => t.id === planTemplateId);

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold text-slate-800">
          {isEdit ? 'Editar equipo' : 'Nuevo equipo'}
        </h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Identificación */}
        <Card>
          <CardHeader><CardTitle className="text-base">Identificación</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Código *" error={errors.code?.message}>
              <Input {...register('code')} placeholder="EQ-001" disabled={isEdit} />
            </Field>
            <Field label="Nombre *" error={errors.name?.message}>
              <Input {...register('name')} placeholder="Compresor de aire industrial" />
            </Field>
            <Field label="Número de serie">
              <Input {...register('serialNumber')} placeholder="SN-2024-XXX" />
            </Field>
            <Field label="Marca">
              <Input {...register('brand')} placeholder="Atlas Copco" />
            </Field>
            <Field label="Modelo">
              <Input {...register('model')} placeholder="CA-500" />
            </Field>
            <Field label="Año de fabricación">
              <Input {...register('year')} type="number" placeholder="2022" min={1900} max={2100} />
            </Field>
          </CardContent>
        </Card>

        {/* Clasificación */}
        <Card>
          <CardHeader><CardTitle className="text-base">Clasificación</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo *" error={errors.type?.message}>
              <Select {...register('type')} options={[
                { value: 'GENERAL', label: 'General' },
                { value: 'BIOMEDICAL', label: 'Biomédico' },
              ]} placeholder="Seleccione..." />
            </Field>
            <Field label="Categoría *" error={errors.category?.message}>
              <Input {...register('category')} placeholder="Neumático, Eléctrico, Diagnóstico..." />
            </Field>
            <Field label="Subcategoría">
              <Input {...register('subcategory')} placeholder="Compresor, Monitor..." />
            </Field>
            {isEdit && (
              <Field label="Estado" error={errors.status?.message}>
                <Select {...register('status')} options={[
                  { value: 'ACTIVE', label: 'Operativo' },
                  { value: 'MAINTENANCE', label: 'En mantenimiento' },
                  { value: 'OUT_OF_SERVICE', label: 'Fuera de servicio' },
                  { value: 'DECOMMISSIONED', label: 'Dado de baja' },
                ]} />
              </Field>
            )}
          </CardContent>
        </Card>

        {/* Ubicación */}
        <Card>
          <CardHeader><CardTitle className="text-base">Ubicación</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Sucursal *" error={errors.branchId?.message}>
              <Select {...register('branchId')} placeholder="Seleccione una sucursal..."
                options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            </Field>
            <Field label="Área / Servicio *" error={errors.locationId?.message}>
              <Select {...register('locationId')}
                placeholder={selectedBranch ? 'Seleccione un área...' : 'Primero seleccione sucursal'}
                disabled={!selectedBranch || locations.length === 0}
                options={locations.map((l) => ({
                  value: l.id,
                  label: [l.building, l.floor, l.area].filter(Boolean).join(' › '),
                }))} />
            </Field>
          </CardContent>
        </Card>

        {/* Activos Fijos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activos Fijos</CardTitle>
            {!isEdit && (
              <p className="text-xs text-slate-400 mt-0.5">El número de activo se genera automáticamente (GEN-XXXX o BIO-XXXX)</p>
            )}
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de compra">
              <Input {...register('purchaseDate')} type="date" />
            </Field>
            <Field label="Valor de adquisición (USD)">
              <Input {...register('purchaseValueUsd')} type="number" placeholder="5000" min={0} step="0.01" />
            </Field>
          </CardContent>
        </Card>

        {/* SLA */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLA — Tiempos de Respuesta</CardTitle>
            <p className="text-xs text-slate-400 mt-0.5">Tiempo máximo para OTs correctivas de este equipo</p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Tiempo de respuesta (horas)">
              <Input {...register('slaResponseHours')} type="number" placeholder="4" min={1} />
            </Field>
            <Field label="Tiempo de resolución (horas)">
              <Input {...register('slaResolutionHours')} type="number" placeholder="24" min={1} />
            </Field>
          </CardContent>
        </Card>

        {/* Plan de Mantenimiento Preventivo — solo en creación */}
        {!isEdit && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Plan de Mantenimiento Preventivo</CardTitle>
                  <p className="text-xs text-slate-400 mt-0.5">Genera OTs automáticas para los próximos 12 meses</p>
                </div>
                <button
                  type="button"
                  onClick={() => setWithPlan(p => !p)}
                  className={cn(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                    withPlan ? 'bg-blue-600' : 'bg-slate-200'
                  )}
                >
                  <span className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                    withPlan ? 'translate-x-6' : 'translate-x-1'
                  )} />
                </button>
              </div>
            </CardHeader>

            {withPlan && (
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nombre del plan *">
                    <Input value={planName} onChange={e => setPlanName(e.target.value)}
                      placeholder="Mantenimiento preventivo mensual" />
                  </Field>
                  <Field label="Frecuencia *">
                    <select
                      value={planFrequency}
                      onChange={e => setPlanFrequency(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Fecha de inicio *">
                    <Input type="date" value={planStartDate} onChange={e => setPlanStartDate(e.target.value)} />
                  </Field>
                  <Field label="Horas estimadas">
                    <Input type="number" value={planEstimatedHours}
                      onChange={e => setPlanEstimatedHours(e.target.value)} placeholder="4" min={0} step="0.5" />
                  </Field>
                  <Field label="Técnico asignado">
                    <select
                      value={planTechnicianId}
                      onChange={e => setPlanTechnicianId(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Sin asignar</option>
                      {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Plantilla de checklist">
                    <select
                      value={planTemplateId}
                      onChange={e => setPlanTemplateId(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Personalizado (manual)</option>
                      {checklistTemplates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}{t.category ? ` — ${t.category}` : ''}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                {planTemplateId && selectedTemplate && (
                  <div className="border rounded-md p-3 bg-blue-50">
                    <p className="text-xs font-medium text-blue-700 mb-2">
                      <Calendar className="h-3 w-3 inline mr-1" />
                      Plantilla seleccionada: {selectedTemplate.name} ({selectedTemplate.items.length} ítems)
                    </p>
                    <ul className="space-y-1">
                      {(selectedTemplate.items as ChecklistItem[]).slice(0, 5).map((item, i) => (
                        <li key={i} className="text-xs text-blue-600">• {item.item}</li>
                      ))}
                      {selectedTemplate.items.length > 5 && (
                        <li className="text-xs text-blue-400">...y {selectedTemplate.items.length - 5} más</li>
                      )}
                    </ul>
                  </div>
                )}

                {!planTemplateId && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Ítems del checklist</label>
                    <div className="flex gap-2">
                      <Input
                        value={newCheckItem}
                        onChange={e => setNewCheckItem(e.target.value)}
                        placeholder="Agregar ítem..."
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCheckItem())}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={addCheckItem}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {planCustomItems.length > 0 && (
                      <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                        {planCustomItems.map((item, idx) => (
                          <div key={item.id} className="flex items-center gap-2 px-3 py-2">
                            <span className="text-xs text-slate-400 w-5">{idx + 1}.</span>
                            <span className="flex-1 text-sm">{item.item}</span>
                            <button
                              type="button"
                              onClick={() => setPlanCustomItems(p => p.filter(i => i.id !== item.id))}
                              className="text-slate-400 hover:text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
                  <Calendar className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-700">
                    Se crearán automáticamente las OTs preventivas para los próximos 12 meses según la frecuencia seleccionada.
                  </p>
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Notas */}
        <Card>
          <CardHeader><CardTitle className="text-base">Observaciones</CardTitle></CardHeader>
          <CardContent>
            <Textarea {...register('notes')} placeholder="Notas adicionales sobre el equipo..." rows={3} />
          </CardContent>
        </Card>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button type="submit" loading={loading}>
            <Save className="h-4 w-4" />
            {isEdit ? 'Guardar cambios' : 'Crear equipo'}
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
