import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { HeadphonesIcon, CheckCircle2, Search } from 'lucide-react';
import api from '@/lib/api';
import type { Branch, Equipment } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const schema = z.object({
  requesterName: z.string().min(2, 'Nombre requerido'),
  requesterEmail: z.string().email('Email inválido'),
  requesterPhone: z.string().optional(),
  branchId: z.string().min(1, 'Seleccione una sucursal'),
  area: z.string().min(2, 'Área requerida'),
  requestType: z.enum(['EQUIPMENT_FAILURE', 'MAINTENANCE_REQUEST', 'OTHER']),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  description: z.string().min(10, 'Descripción muy corta (mínimo 10 caracteres)'),
  equipmentId: z.string().optional(),
  equipmentSearch: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export default function HelpdeskPublicForm() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [equipmentResults, setEquipmentResults] = useState<Equipment[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [submitted, setSubmitted] = useState<{ code: string; token: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { requestType: 'EQUIPMENT_FAILURE', priority: 'MEDIUM' },
  });

  const equipmentSearch = watch('equipmentSearch');

  useEffect(() => {
    api.get('/branches').then(({ data }) => setBranches(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (!equipmentSearch || equipmentSearch.length < 2 || selectedEquipment) return;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/equipments?search=${encodeURIComponent(equipmentSearch)}&limit=6`);
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

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const { data: result } = await api.post('/helpdesk/tickets', {
        requesterName: data.requesterName,
        requesterEmail: data.requesterEmail,
        requesterPhone: data.requesterPhone || undefined,
        branchId: data.branchId,
        area: data.area,
        requestType: data.requestType,
        priority: data.priority,
        description: data.description,
        equipmentId: data.equipmentId || undefined,
      });
      setSubmitted({ code: result.code, token: result.trackingToken });
    } catch {
      alert('Error al enviar la solicitud. Por favor intente nuevamente.');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-4">
          <div className="rounded-full bg-green-100 p-4 inline-flex">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">¡Solicitud enviada!</h1>
          <p className="text-slate-500">
            Su ticket ha sido registrado con el número{' '}
            <span className="font-bold text-slate-800">{submitted.code}</span>.
          </p>
          <p className="text-slate-500 text-sm">
            Le enviamos un correo de confirmación con el enlace de seguimiento.
          </p>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500 mb-2">Enlace de seguimiento:</p>
              <a
                href={`/helpdesk/ticket/${submitted.token}`}
                className="text-blue-600 text-sm font-medium hover:underline break-all"
              >
                {window.location.origin}/helpdesk/ticket/{submitted.token}
              </a>
            </CardContent>
          </Card>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Enviar otra solicitud
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-start justify-center p-4 py-8">
      <div className="w-full max-w-lg space-y-5">
        {/* Header */}
        <div className="text-center">
          <div className="rounded-full bg-blue-100 p-3 inline-flex mb-3">
            <HeadphonesIcon className="h-8 w-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Mesa de Ayuda</h1>
          <p className="text-sm text-slate-500 mt-1">
            Complete el formulario y le daremos seguimiento por correo electrónico
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Datos del solicitante */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sus datos</CardTitle>
              <CardDescription>Para enviarle el seguimiento por email</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Nombre completo *</Label>
                <Input {...register('requesterName')} placeholder="Juan Pérez" />
                {errors.requesterName && <p className="text-xs text-destructive">{errors.requesterName.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Correo electrónico *</Label>
                <Input {...register('requesterEmail')} type="email" placeholder="juan@empresa.com" />
                {errors.requesterEmail && <p className="text-xs text-destructive">{errors.requesterEmail.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Teléfono / Extensión</Label>
                <Input {...register('requesterPhone')} placeholder="Ext. 101" />
              </div>
            </CardContent>
          </Card>

          {/* Ubicación */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ubicación</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Sucursal *</Label>
                <Select
                  {...register('branchId')}
                  placeholder="Seleccione..."
                  options={branches.map((b) => ({ value: b.id, label: b.name }))}
                />
                {errors.branchId && <p className="text-xs text-destructive">{errors.branchId.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Área / Servicio *</Label>
                <Input {...register('area')} placeholder="UCI, Radiología, Taller..." />
                {errors.area && <p className="text-xs text-destructive">{errors.area.message}</p>}
              </div>
            </CardContent>
          </Card>

          {/* Solicitud */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detalle de la solicitud</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Tipo de solicitud *</Label>
                  <Select
                    {...register('requestType')}
                    options={[
                      { value: 'EQUIPMENT_FAILURE', label: 'Falla de equipo' },
                      { value: 'MAINTENANCE_REQUEST', label: 'Solicitud de mantenimiento' },
                      { value: 'OTHER', label: 'Otro' },
                    ]}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Prioridad sugerida *</Label>
                  <Select
                    {...register('priority')}
                    options={[
                      { value: 'CRITICAL', label: '🔴 Crítica' },
                      { value: 'HIGH', label: '🟠 Alta' },
                      { value: 'MEDIUM', label: '🟡 Media' },
                      { value: 'LOW', label: '🟢 Baja' },
                    ]}
                  />
                </div>
              </div>

              {/* Equipment search (optional) */}
              <div className="space-y-1.5">
                <Label>Equipo relacionado (opcional)</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    {...register('equipmentSearch')}
                    placeholder="Buscar por nombre o código..."
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
                      Quitar
                    </button>
                  )}
                </div>
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
                  <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
                    <span className="font-medium">{selectedEquipment.name}</span>
                    <span className="ml-2 font-mono text-blue-400">{selectedEquipment.code}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Descripción del problema *</Label>
                <Textarea
                  {...register('description')}
                  placeholder="Describa detalladamente el problema o la solicitud..."
                  rows={4}
                />
                {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
              </div>
            </CardContent>
          </Card>

          <Button type="submit" className="w-full" loading={loading} size="lg">
            Enviar solicitud
          </Button>
        </form>
      </div>
    </div>
  );
}
