import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { Plus, Pencil, Power, Truck, ClipboardList, ChevronLeft, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import type { Provider, WorkOrder } from '@/types';
import { WO_STATUS_LABEL, WO_STATUS_COLOR, formatDate, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ProviderFormData {
  name: string; nit: string; contact: string;
  email: string; phone: string; specialty: string; city: string;
}

export default function Providers() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState<'form' | 'performance' | null>(null);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [performance, setPerformance] = useState<WorkOrder[]>([]);
  const [perfLoading, setPerfLoading] = useState(false);

  const form = useForm<ProviderFormData>({
    defaultValues: { name: '', nit: '', contact: '', email: '', phone: '', specialty: '', city: '' },
  });

  const fetchProviders = async () => {
    try {
      const { data } = await api.get('/providers' + (showInactive ? '?active=all' : ''));
      setProviders(data);
    } catch {
      toast.error('Error al cargar proveedores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProviders(); }, [showInactive]);

  function openCreate() {
    form.reset({ name: '', nit: '', contact: '', email: '', phone: '', specialty: '', city: '' });
    setSelected(null);
    setDialog('form');
  }

  function openEdit(p: Provider) {
    form.reset({
      name: p.name, nit: p.nit ?? '', contact: p.contact ?? '',
      email: p.email ?? '', phone: p.phone ?? '', specialty: p.specialty ?? '', city: p.city ?? '',
    });
    setSelected(p);
    setDialog('form');
  }

  async function openPerformance(p: Provider) {
    setSelected(p);
    setPerformance([]);
    setDialog('performance');
    setPerfLoading(true);
    try {
      const { data } = await api.get(`/providers/${p.id}/performance`);
      setPerformance(data);
    } catch {
      toast.error('Error al cargar historial');
    } finally {
      setPerfLoading(false);
    }
  }

  async function onSubmit(vals: ProviderFormData) {
    try {
      if (selected) {
        const { data } = await api.put(`/providers/${selected.id}`, vals);
        setProviders((prev) => prev.map((p) => (p.id === data.id ? data : p)));
        toast.success('Proveedor actualizado');
      } else {
        const { data } = await api.post('/providers', vals);
        setProviders((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success('Proveedor creado');
      }
      setDialog(null);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al guardar proveedor');
    }
  }

  async function toggleActive(p: Provider) {
    try {
      const { data } = await api.put(`/providers/${p.id}`, { ...p, active: !p.active });
      setProviders((prev) => prev.map((x) => (x.id === data.id ? data : x)));
      toast.success(data.active ? 'Proveedor activado' : 'Proveedor desactivado');
    } catch {
      toast.error('Error al cambiar estado');
    }
  }

  const visible = showInactive ? providers : providers.filter((p) => p.active);
  const completedCount = (p: Provider) =>
    performance.filter((wo) => ['COMPLETED', 'VERIFIED', 'CLOSED'].includes(wo.status)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-800">Proveedores</h1>
          <span className="text-sm text-slate-400">({visible.length})</span>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowInactive((v) => !v)}
            className={showInactive ? 'bg-slate-100' : ''}
          >
            {showInactive ? 'Ocultar inactivos' : 'Ver inactivos'}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Nuevo proveedor
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : visible.length === 0 ? (
            <p className="text-center py-12 text-sm text-slate-400">Sin proveedores registrados</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-xs font-medium text-slate-500 uppercase">
                  <th className="px-4 py-3 text-left">Nombre / Razón social</th>
                  <th className="px-4 py-3 text-left">NIT</th>
                  <th className="px-4 py-3 text-left">Especialidad</th>
                  <th className="px-4 py-3 text-left">Ciudad</th>
                  <th className="px-4 py-3 text-left">Contacto</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((p) => (
                  <tr key={p.id} className={cn('hover:bg-slate-50 transition-colors', !p.active && 'opacity-50')}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800">{p.name}</p>
                      {!p.active && <p className="text-xs text-slate-400">Inactivo</p>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{p.nit ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{p.specialty ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{p.city ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      <p>{p.contact ?? '—'}</p>
                      {p.email && <p className="text-xs">{p.email}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openPerformance(p)}
                          title="Ver historial de OTs"
                        >
                          <ClipboardList className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)} title="Editar">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleActive(p)}
                          title={p.active ? 'Desactivar' : 'Activar'}
                          className={p.active ? 'text-red-500 hover:text-red-700' : 'text-green-600 hover:text-green-700'}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── Crear / Editar ──────────────────────────────────────────────────── */}
      <Dialog
        open={dialog === 'form'}
        onClose={() => setDialog(null)}
        title={selected ? `Editar — ${selected.name}` : 'Nuevo proveedor'}
      >
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Razón social *</label>
              <Input {...form.register('name', { required: true })} placeholder="Nombre del proveedor" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">NIT</label>
              <Input {...form.register('nit')} placeholder="000.000.000-0" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Especialidad</label>
              <Input {...form.register('specialty')} placeholder="ej. Equipos biomédicos" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ciudad</label>
              <Input {...form.register('city')} placeholder="Bogotá" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Contacto</label>
              <Input {...form.register('contact')} placeholder="Nombre del contacto" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email</label>
              <Input {...form.register('email')} type="email" placeholder="proveedor@empresa.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Teléfono</label>
              <Input {...form.register('phone')} placeholder="+57 300 000 0000" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button type="submit">{selected ? 'Guardar cambios' : 'Crear proveedor'}</Button>
          </div>
        </form>
      </Dialog>

      {/* ── Historial de OTs ────────────────────────────────────────────────── */}
      <Dialog
        open={dialog === 'performance'}
        onClose={() => setDialog(null)}
        title={`Historial — ${selected?.name}`}
        description={selected?.specialty ?? undefined}
      >
        <div className="space-y-3">
          {perfLoading ? (
            <div className="flex justify-center py-8">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : performance.length === 0 ? (
            <p className="text-center py-8 text-sm text-slate-400">Sin órdenes de trabajo asignadas</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-slate-50 border p-3">
                  <p className="text-2xl font-bold text-slate-700">{performance.length}</p>
                  <p className="text-xs text-slate-400 mt-1">Total OTs</p>
                </div>
                <div className="rounded-lg bg-green-50 border border-green-100 p-3">
                  <p className="text-2xl font-bold text-green-600">
                    {performance.filter((w) => ['COMPLETED', 'VERIFIED', 'CLOSED'].includes(w.status)).length}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Completadas</p>
                </div>
                <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
                  <p className="text-2xl font-bold text-blue-600">
                    {performance.filter((w) => ['OPEN', 'IN_PROGRESS'].includes(w.status)).length}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">En curso</p>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto border rounded-md divide-y">
                {performance.map((wo) => (
                  <div
                    key={wo.id}
                    className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 cursor-pointer"
                    onClick={() => { setDialog(null); navigate(`/mantenimiento/${wo.id}`); }}
                  >
                    <div>
                      <p className="text-sm font-mono font-medium">{wo.code}</p>
                      <p className="text-xs text-slate-500">{(wo as any).equipment?.name ?? '—'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{formatDate(wo.scheduledDate ?? wo.createdAt)}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', WO_STATUS_COLOR[wo.status])}>
                        {WO_STATUS_LABEL[wo.status]}
                      </span>
                      <ExternalLink className="h-3 w-3 text-slate-300" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Dialog>
    </div>
  );
}
