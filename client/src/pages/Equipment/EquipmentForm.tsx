import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ChevronLeft, Save } from 'lucide-react';
import api from '@/lib/api';
import type { Branch, Location } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
  assetNumber: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchaseValue: z.string().optional(),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'DECOMMISSIONED']).default('ACTIVE'),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export default function EquipmentForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const selectedBranch = watch('branchId');

  // Cargar sucursales
  useEffect(() => {
    api.get('/branches').then(({ data }) => setBranches(data)).catch(() => {});
  }, []);

  // Filtrar ubicaciones según sucursal seleccionada
  useEffect(() => {
    if (!selectedBranch) { setLocations([]); return; }
    const branch = branches.find((b) => b.id === selectedBranch);
    setLocations(branch?.locations ?? []);
    setValue('locationId', '');
  }, [selectedBranch, branches, setValue]);

  // Cargar datos en modo edición
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
        assetNumber: data.assetNumber ?? '',
        purchaseDate: data.purchaseDate ? data.purchaseDate.substring(0, 10) : '',
        purchaseValue: data.purchaseValue ? String(data.purchaseValue) : '',
        status: data.status,
        notes: data.notes ?? '',
      });
    }).catch(() => toast.error('No se pudo cargar el equipo'));
  }, [id, isEdit, reset]);

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const payload = {
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
        assetNumber: data.assetNumber || null,
        purchaseDate: data.purchaseDate || null,
        purchaseValue: data.purchaseValue ? parseFloat(data.purchaseValue) : null,
        status: data.status,
        notes: data.notes || null,
      };

      if (isEdit) {
        await api.put(`/equipments/${id}`, payload);
        toast.success('Equipo actualizado correctamente');
        navigate(`/equipos/${id}`);
      } else {
        const { data: created } = await api.post('/equipments', payload);
        toast.success('Equipo creado correctamente');
        navigate(`/equipos/${created.id}`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al guardar el equipo');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header */}
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
              <Input
                {...register('code')}
                placeholder="EQ-001"
                disabled={isEdit}
              />
            </Field>
            <Field label="Nombre *" error={errors.name?.message}>
              <Input {...register('name')} placeholder="Compresor de aire industrial" />
            </Field>
            <Field label="Número de serie" error={errors.serialNumber?.message}>
              <Input {...register('serialNumber')} placeholder="SN-2024-XXX" />
            </Field>
            <Field label="Marca" error={errors.brand?.message}>
              <Input {...register('brand')} placeholder="Atlas Copco" />
            </Field>
            <Field label="Modelo" error={errors.model?.message}>
              <Input {...register('model')} placeholder="CA-500" />
            </Field>
            <Field label="Año de fabricación" error={errors.year?.message}>
              <Input {...register('year')} type="number" placeholder="2022" min={1900} max={2100} />
            </Field>
          </CardContent>
        </Card>

        {/* Clasificación */}
        <Card>
          <CardHeader><CardTitle className="text-base">Clasificación</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo *" error={errors.type?.message}>
              <Select
                {...register('type')}
                options={[
                  { value: 'GENERAL', label: 'General' },
                  { value: 'BIOMEDICAL', label: 'Biomédico' },
                ]}
                placeholder="Seleccione..."
              />
            </Field>
            <Field label="Categoría *" error={errors.category?.message}>
              <Input {...register('category')} placeholder="Neumático, Eléctrico, Diagnóstico..." />
            </Field>
            <Field label="Subcategoría" error={errors.subcategory?.message}>
              <Input {...register('subcategory')} placeholder="Compresor, Monitor..." />
            </Field>
            {isEdit && (
              <Field label="Estado" error={errors.status?.message}>
                <Select
                  {...register('status')}
                  options={[
                    { value: 'ACTIVE', label: 'Operativo' },
                    { value: 'MAINTENANCE', label: 'En mantenimiento' },
                    { value: 'OUT_OF_SERVICE', label: 'Fuera de servicio' },
                    { value: 'DECOMMISSIONED', label: 'Dado de baja' },
                  ]}
                />
              </Field>
            )}
          </CardContent>
        </Card>

        {/* Ubicación */}
        <Card>
          <CardHeader><CardTitle className="text-base">Ubicación</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Sucursal *" error={errors.branchId?.message}>
              <Select
                {...register('branchId')}
                placeholder="Seleccione una sucursal..."
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
            </Field>
            <Field label="Área / Servicio *" error={errors.locationId?.message}>
              <Select
                {...register('locationId')}
                placeholder={selectedBranch ? 'Seleccione un área...' : 'Primero seleccione sucursal'}
                disabled={!selectedBranch || locations.length === 0}
                options={locations.map((l) => ({
                  value: l.id,
                  label: [l.building, l.floor, l.area].filter(Boolean).join(' › '),
                }))}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Activos Fijos */}
        <Card>
          <CardHeader><CardTitle className="text-base">Activos Fijos</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="N.º de activo" error={errors.assetNumber?.message}>
              <Input {...register('assetNumber')} placeholder="AF-0001" />
            </Field>
            <Field label="Fecha de compra" error={errors.purchaseDate?.message}>
              <Input {...register('purchaseDate')} type="date" />
            </Field>
            <Field label="Valor de adquisición (COP)" error={errors.purchaseValue?.message}>
              <Input {...register('purchaseValue')} type="number" placeholder="15000000" min={0} />
            </Field>
          </CardContent>
        </Card>

        {/* Notas */}
        <Card>
          <CardHeader><CardTitle className="text-base">Observaciones</CardTitle></CardHeader>
          <CardContent>
            <Textarea {...register('notes')} placeholder="Notas adicionales sobre el equipo..." rows={3} />
          </CardContent>
        </Card>

        {/* Acciones */}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            <Save className="h-4 w-4" />
            {isEdit ? 'Guardar cambios' : 'Crear equipo'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
