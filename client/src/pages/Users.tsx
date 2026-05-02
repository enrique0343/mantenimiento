import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { UserPlus, Pencil, ShieldCheck, KeyRound, Power, Users as UsersIcon } from 'lucide-react';
import api from '@/lib/api';
import { ROLE_LABEL, cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import type { AuthUser, Branch } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';

interface UserItem extends AuthUser {
  active: boolean;
}

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'MAINTENANCE_CHIEF', label: 'Jefe de Mantenimiento' },
  { value: 'TECHNICIAN', label: 'Técnico' },
  { value: 'PROVIDER', label: 'Proveedor' },
  { value: 'VIEWER', label: 'Visualizador' },
];

const ROLE_COLOR: Record<string, string> = {
  ADMIN: 'bg-red-100 text-red-700',
  MAINTENANCE_CHIEF: 'bg-blue-100 text-blue-700',
  TECHNICIAN: 'bg-green-100 text-green-700',
  PROVIDER: 'bg-purple-100 text-purple-700',
  VIEWER: 'bg-slate-100 text-slate-600',
};

export default function Users() {
  const { user: me } = useAuthStore();
  const isAdmin = me?.role === 'ADMIN';

  const [users, setUsers] = useState<UserItem[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<'create' | 'edit' | 'role' | 'password' | null>(null);
  const [selected, setSelected] = useState<UserItem | null>(null);

  const form = useForm<{ name: string; email: string; password: string; role: string; branchId: string }>(
    { defaultValues: { role: 'TECHNICIAN', branchId: '' } }
  );
  const roleForm = useForm<{ role: string }>();
  const pwForm = useForm<{ password: string; confirm: string }>();

  useEffect(() => {
    Promise.all([api.get('/users'), api.get('/branches')])
      .then(([uRes, bRes]) => { setUsers(uRes.data); setBranches(bRes.data); })
      .catch(() => toast.error('Error al cargar datos'))
      .finally(() => setLoading(false));
  }, []);

  function openCreate() {
    form.reset({ name: '', email: '', password: '', role: 'TECHNICIAN', branchId: '' });
    setSelected(null);
    setDialog('create');
  }
  function openEdit(u: UserItem) {
    form.reset({ name: u.name, email: u.email, password: '', role: u.role, branchId: u.branchId ?? '' });
    setSelected(u);
    setDialog('edit');
  }
  function openRole(u: UserItem) {
    roleForm.reset({ role: u.role });
    setSelected(u);
    setDialog('role');
  }
  function openPassword(u: UserItem) {
    pwForm.reset({ password: '', confirm: '' });
    setSelected(u);
    setDialog('password');
  }

  async function onCreate(vals: any) {
    try {
      const { data } = await api.post('/users', { ...vals, branchId: vals.branchId || null });
      setUsers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setDialog(null);
      toast.success('Usuario creado');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al crear usuario');
    }
  }

  async function onEdit(vals: any) {
    if (!selected) return;
    try {
      const { data } = await api.patch(`/users/${selected.id}`, {
        name: vals.name, email: vals.email, branchId: vals.branchId || null,
      });
      setUsers((prev) => prev.map((u) => (u.id === data.id ? { ...u, ...data } : u)));
      setDialog(null);
      toast.success('Usuario actualizado');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al actualizar');
    }
  }

  async function onChangeRole(vals: { role: string }) {
    if (!selected) return;
    try {
      const { data } = await api.patch(`/users/${selected.id}/role`, { role: vals.role });
      setUsers((prev) => prev.map((u) => (u.id === data.id ? { ...u, role: data.role } : u)));
      setDialog(null);
      toast.success('Rol actualizado');
    } catch { toast.error('Error al cambiar rol'); }
  }

  async function onChangePassword(vals: { password: string; confirm: string }) {
    if (!selected) return;
    if (vals.password !== vals.confirm) {
      pwForm.setError('confirm', { message: 'Las contraseñas no coinciden' });
      return;
    }
    try {
      await api.patch(`/users/${selected.id}/password`, { password: vals.password });
      setDialog(null);
      toast.success('Contraseña actualizada');
    } catch { toast.error('Error al cambiar contraseña'); }
  }

  async function toggleActive(u: UserItem) {
    try {
      const { data } = await api.patch(`/users/${u.id}`, { active: !u.active });
      setUsers((prev) => prev.map((x) => (x.id === data.id ? { ...x, active: data.active } : x)));
      toast.success(data.active ? 'Usuario activado' : 'Usuario desactivado');
    } catch { toast.error('Error al cambiar estado'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UsersIcon className="h-5 w-5 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-800">Usuarios</h1>
          <span className="text-sm text-slate-400">({users.length})</span>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={openCreate}>
            <UserPlus className="h-4 w-4" />
            Nuevo usuario
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-center py-12 text-sm text-slate-400">Sin usuarios registrados</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-xs font-medium text-slate-500 uppercase">
                  <th className="px-4 py-3 text-left">Nombre</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Rol</th>
                  <th className="px-4 py-3 text-left">Sucursal</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  {isAdmin && <th className="px-4 py-3 text-right">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((u) => (
                  <tr key={u.id} className={cn('hover:bg-slate-50 transition-colors', !u.active && 'opacity-50')}>
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {u.name}
                      {u.id === me?.id && <span className="ml-2 text-xs text-slate-400 font-normal">(tú)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{u.email}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', ROLE_COLOR[u.role])}>
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{(u as any).branch?.name ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('text-xs font-medium', u.active ? 'text-green-600' : 'text-slate-400')}>
                        {u.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(u)} title="Editar datos">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openRole(u)} title="Cambiar rol">
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openPassword(u)} title="Cambiar contraseña">
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          {u.id !== me?.id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => toggleActive(u)}
                              title={u.active ? 'Desactivar' : 'Activar'}
                              className={u.active ? 'text-red-500 hover:text-red-700' : 'text-green-600 hover:text-green-700'}
                            >
                              <Power className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Crear */}
      <Dialog open={dialog === 'create'} onClose={() => setDialog(null)} title="Nuevo usuario">
        <form onSubmit={form.handleSubmit(onCreate)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nombre *</label>
              <Input {...form.register('name', { required: true })} placeholder="Nombre completo" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email *</label>
              <Input {...form.register('email', { required: true })} type="email" placeholder="correo@empresa.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Contraseña *</label>
              <Input
                {...form.register('password', { required: true, minLength: 8 })}
                type="password"
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Rol *</label>
              <Select
                value={form.watch('role')}
                onChange={(e) => form.setValue('role', e.target.value)}
                options={ROLE_OPTIONS}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Sucursal</label>
              <Select
                value={form.watch('branchId')}
                onChange={(e) => form.setValue('branchId', e.target.value)}
                placeholder="Sin asignar"
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button type="submit">Crear usuario</Button>
          </div>
        </form>
      </Dialog>

      {/* Editar */}
      <Dialog open={dialog === 'edit'} onClose={() => setDialog(null)} title={`Editar — ${selected?.name}`}>
        <form onSubmit={form.handleSubmit(onEdit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nombre *</label>
              <Input {...form.register('name', { required: true })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email *</label>
              <Input {...form.register('email', { required: true })} type="email" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Sucursal</label>
              <Select
                value={form.watch('branchId')}
                onChange={(e) => form.setValue('branchId', e.target.value)}
                placeholder="Sin asignar"
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button type="submit">Guardar cambios</Button>
          </div>
        </form>
      </Dialog>

      {/* Cambiar rol */}
      <Dialog
        open={dialog === 'role'}
        onClose={() => setDialog(null)}
        title={`Cambiar rol — ${selected?.name}`}
        description="El nuevo rol aplica en el próximo inicio de sesión."
      >
        <form onSubmit={roleForm.handleSubmit(onChangeRole)} className="space-y-4">
          <Select
            value={roleForm.watch('role')}
            onChange={(e) => roleForm.setValue('role', e.target.value)}
            options={ROLE_OPTIONS}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button type="submit">Cambiar rol</Button>
          </div>
        </form>
      </Dialog>

      {/* Cambiar contraseña */}
      <Dialog
        open={dialog === 'password'}
        onClose={() => setDialog(null)}
        title={`Cambiar contraseña — ${selected?.name}`}
      >
        <form onSubmit={pwForm.handleSubmit(onChangePassword)} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nueva contraseña *</label>
            <Input
              {...pwForm.register('password', { required: true, minLength: 8 })}
              type="password"
              placeholder="Mínimo 8 caracteres"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Confirmar contraseña *</label>
            <Input {...pwForm.register('confirm', { required: true })} type="password" />
            {pwForm.formState.errors.confirm && (
              <p className="text-xs text-red-500">{pwForm.formState.errors.confirm.message}</p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button type="submit">Cambiar contraseña</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
