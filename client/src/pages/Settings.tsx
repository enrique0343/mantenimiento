import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import {
  Settings as SettingsIcon, Building2, Image, MapPin, Mail,
  Upload, X, Plus, Pencil, Power, Loader2, SendHorizonal, ChevronDown, ChevronRight,
  ClipboardList, Trash2,
} from 'lucide-react';
import api from '@/lib/api';
import type { Branch } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Tab = 'empresa' | 'logo' | 'sucursales' | 'smtp' | 'checklists';

interface Company {
  id?: string; name: string; nit?: string; address?: string; phone?: string;
  email?: string; logoUrl?: string; smtpHost?: string; smtpPort?: number;
  smtpUser?: string; smtpFromName?: string; smtpSecure?: boolean;
}

interface Location { id: string; area: string; building?: string; floor?: string; }

const TIMEZONES = [
  { value: 'America/Bogota', label: 'Bogotá (UTC-5)' },
  { value: 'America/Caracas', label: 'Caracas (UTC-4)' },
  { value: 'America/Lima', label: 'Lima (UTC-5)' },
  { value: 'America/Mexico_City', label: 'Ciudad de México (UTC-6)' },
  { value: 'America/Santiago', label: 'Santiago (UTC-4)' },
  { value: 'America/Buenos_Aires', label: 'Buenos Aires (UTC-3)' },
];

const TABS = [
  { id: 'empresa' as Tab, label: 'Empresa', icon: Building2 },
  { id: 'logo' as Tab, label: 'Logo', icon: Image },
  { id: 'sucursales' as Tab, label: 'Sucursales', icon: MapPin },
  { id: 'smtp' as Tab, label: 'SMTP / Email', icon: Mail },
  { id: 'checklists' as Tab, label: 'Checklists', icon: ClipboardList },
];

export default function Settings() {
  const [tab, setTab] = useState<Tab>('empresa');
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => setCompany(data))
      .catch(() => toast.error('Error al cargar configuración'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <SettingsIcon className="h-5 w-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Configuración</h1>
      </div>

      {/* Tab bar */}
      <div className="flex border-b gap-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'empresa' && (
        <EmpresaTab company={company} onSave={setCompany} />
      )}
      {tab === 'logo' && (
        <LogoTab company={company} onSave={setCompany} />
      )}
      {tab === 'sucursales' && (
        <SucursalesTab company={company} />
      )}
      {tab === 'smtp' && (
        <SmtpTab company={company} onSave={setCompany} />
      )}
      {tab === 'checklists' && <ChecklistsTab />}
    </div>
  );
}

// ─── Empresa ─────────────────────────────────────────────────────────────────

function EmpresaTab({ company, onSave }: { company: Company | null; onSave: (c: Company) => void }) {
  const { register, handleSubmit, reset } = useForm<Company>({
    defaultValues: company ?? {},
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (company) reset(company); }, [company]);

  async function onSubmit(vals: Company) {
    setSaving(true);
    try {
      const { data } = await api.put('/settings', vals);
      onSave(data);
      toast.success('Datos guardados');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" />Datos de la empresa</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Razón social *</label>
              <Input {...register('name', { required: true })} placeholder="Nombre de la empresa" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">NIT</label>
              <Input {...register('nit')} placeholder="000.000.000-0" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email de contacto</label>
              <Input {...register('email')} type="email" placeholder="info@empresa.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Teléfono</label>
              <Input {...register('phone')} placeholder="+57 600 000 0000" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Dirección</label>
              <Input {...register('address')} placeholder="Calle 1 # 2-3, Bogotá" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>Guardar cambios</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Logo ────────────────────────────────────────────────────────────────────

function LogoTab({ company, onSave }: { company: Company | null; onSave: (c: Company) => void }) {
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const { data } = await api.post('/settings/logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onSave(data);
      toast.success('Logo actualizado');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al subir el logo');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    setRemoving(true);
    try {
      const { data } = await api.delete('/settings/logo');
      onSave(data);
      toast.success('Logo eliminado');
    } catch {
      toast.error('Error al eliminar el logo');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Image className="h-4 w-4" />Logo de la empresa</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-500">
          El logo aparece en los encabezados de todos los PDFs generados. Formatos: JPG, PNG, WEBP — máx. 5 MB.
        </p>

        {company?.logoUrl ? (
          <div className="flex items-start gap-6">
            <div className="rounded-lg border bg-slate-50 p-4 flex items-center justify-center w-48 h-24">
              <img
                src={company.logoUrl}
                alt="Logo actual"
                className="max-w-full max-h-full object-contain"
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Logo actual</p>
              <p className="text-xs text-slate-400 break-all max-w-xs">{company.logoUrl.split('/').pop()}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  loading={uploading}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Cambiar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={removeLogo}
                  loading={removing}
                  className="text-red-500 hover:text-red-700 border-red-200"
                >
                  <X className="h-3.5 w-3.5" />
                  Eliminar
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div
            onClick={() => !uploading && fileRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-lg p-12 text-center transition-colors',
              uploading ? 'cursor-default' : 'cursor-pointer hover:border-primary hover:bg-blue-50'
            )}
          >
            {uploading ? (
              <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin" />
            ) : (
              <>
                <Upload className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-500">Haz clic para subir el logo</p>
                <p className="text-xs text-slate-400 mt-1">JPG, PNG o WEBP · máx. 5 MB</p>
              </>
            )}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFile}
        />
      </CardContent>
    </Card>
  );
}

// ─── Sucursales ───────────────────────────────────────────────────────────────

function SucursalesTab({ company }: { company: Company | null }) {
  const [branches, setBranches] = useState<(Branch & { locations: Location[] })[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<'branch' | 'location' | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const branchForm = useForm<{ name: string; city: string; address: string; phone: string; timezone: string }>(
    { defaultValues: { timezone: 'America/Bogota' } }
  );
  const locationForm = useForm<{ area: string; building: string; floor: string }>();

  useEffect(() => {
    api.get('/branches?active=all')
      .then(({ data }) => setBranches(data))
      .catch(() => toast.error('Error al cargar sucursales'))
      .finally(() => setLoading(false));
  }, []);

  function openCreate() {
    branchForm.reset({ name: '', city: '', address: '', phone: '', timezone: 'America/Bogota' });
    setSelectedBranch(null);
    setDialog('branch');
  }

  function openEdit(b: Branch) {
    branchForm.reset({ name: b.name, city: b.city ?? '', address: b.address ?? '', phone: b.phone ?? '', timezone: b.timezone });
    setSelectedBranch(b);
    setDialog('branch');
  }

  function openAddLocation(b: Branch) {
    locationForm.reset({ area: '', building: '', floor: '' });
    setSelectedBranch(b);
    setDialog('location');
  }

  async function onSubmitBranch(vals: any) {
    try {
      if (selectedBranch) {
        const { data } = await api.put(`/branches/${selectedBranch.id}`, vals);
        setBranches((prev) => prev.map((b) => (b.id === data.id ? { ...b, ...data } : b)));
        toast.success('Sucursal actualizada');
      } else {
        const companyId = company?.id;
        if (!companyId) { toast.error('Guarde los datos de empresa primero'); return; }
        const { data } = await api.post('/branches', { ...vals, companyId });
        setBranches((prev) => [...prev, { ...data, locations: [] }]);
        toast.success('Sucursal creada');
      }
      setDialog(null);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al guardar');
    }
  }

  async function onSubmitLocation(vals: any) {
    if (!selectedBranch) return;
    try {
      const { data } = await api.post(`/branches/${selectedBranch.id}/locations`, vals);
      setBranches((prev) => prev.map((b) =>
        b.id === selectedBranch.id ? { ...b, locations: [...(b.locations ?? []), data] } : b
      ));
      setDialog(null);
      toast.success('Área añadida');
    } catch {
      toast.error('Error al añadir área');
    }
  }

  async function toggleBranchActive(b: Branch) {
    try {
      const { data } = await api.put(`/branches/${b.id}`, { ...b, active: !b.active });
      setBranches((prev) => prev.map((x) => (x.id === data.id ? { ...x, active: data.active } : x)));
      toast.success(data.active ? 'Sucursal activada' : 'Sucursal desactivada');
    } catch { toast.error('Error al cambiar estado'); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{branches.filter(b => b.active).length} sucursal(es) activa(s)</p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nueva sucursal
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : branches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-400">Sin sucursales registradas</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {branches.map((b) => (
            <Card key={b.id} className={cn(!b.active && 'opacity-60')}>
              <CardContent className="p-0">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    {expanded === b.id
                      ? <ChevronDown className="h-4 w-4" />
                      : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="flex-1">
                    <p className="font-medium text-slate-800">{b.name}</p>
                    <p className="text-xs text-slate-400">{[b.city, b.address].filter(Boolean).join(' · ')}</p>
                  </div>
                  <span className={cn('text-xs font-medium', b.active ? 'text-green-600' : 'text-slate-400')}>
                    {b.active ? 'Activa' : 'Inactiva'}
                  </span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(b)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openAddLocation(b)} title="Añadir área">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleBranchActive(b)}
                      className={b.active ? 'text-red-500 hover:text-red-700' : 'text-green-600 hover:text-green-700'}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {expanded === b.id && (
                  <div className="border-t px-4 py-3 bg-slate-50">
                    <p className="text-xs font-medium text-slate-500 uppercase mb-2">
                      Áreas / Servicios ({b.locations?.length ?? 0})
                    </p>
                    {!b.locations?.length ? (
                      <p className="text-xs text-slate-400">Sin áreas registradas</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-1">
                        {b.locations.map((loc) => (
                          <div key={loc.id} className="text-xs text-slate-600 bg-white rounded border px-2 py-1.5">
                            <span className="font-medium">{loc.area}</span>
                            {(loc.building || loc.floor) && (
                              <span className="text-slate-400 ml-1">
                                · {[loc.building, loc.floor].filter(Boolean).join(', ')}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Branch form dialog */}
      <Dialog
        open={dialog === 'branch'}
        onClose={() => setDialog(null)}
        title={selectedBranch ? `Editar — ${selectedBranch.name}` : 'Nueva sucursal'}
      >
        <form onSubmit={branchForm.handleSubmit(onSubmitBranch)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Nombre *</label>
              <Input {...branchForm.register('name', { required: true })} placeholder="Sede Norte" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ciudad</label>
              <Input {...branchForm.register('city')} placeholder="Bogotá" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Teléfono</label>
              <Input {...branchForm.register('phone')} placeholder="+57 600 000 0000" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Dirección</label>
              <Input {...branchForm.register('address')} placeholder="Calle 1 # 2-3" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Zona horaria</label>
              <Select
                value={branchForm.watch('timezone')}
                onChange={(e) => branchForm.setValue('timezone', e.target.value)}
                options={TIMEZONES}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button type="submit">{selectedBranch ? 'Guardar' : 'Crear sucursal'}</Button>
          </div>
        </form>
      </Dialog>

      {/* Location form dialog */}
      <Dialog
        open={dialog === 'location'}
        onClose={() => setDialog(null)}
        title={`Añadir área — ${selectedBranch?.name}`}
      >
        <form onSubmit={locationForm.handleSubmit(onSubmitLocation)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Área / Servicio *</label>
              <Input {...locationForm.register('area', { required: true })} placeholder="ej. UCI, Radiología, Taller" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Edificio / Bloque</label>
              <Input {...locationForm.register('building')} placeholder="Bloque A" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Piso / Nivel</label>
              <Input {...locationForm.register('floor')} placeholder="Piso 2" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button type="submit">Añadir área</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// ─── SMTP ─────────────────────────────────────────────────────────────────────

function SmtpTab({ company, onSave }: { company: Company | null; onSave: (c: Company) => void }) {
  const { register, handleSubmit, reset, watch } = useForm({
    defaultValues: {
      smtpHost: company?.smtpHost ?? '',
      smtpPort: company?.smtpPort ?? 587,
      smtpUser: company?.smtpUser ?? '',
      smtpPass: '',
      smtpFromName: company?.smtpFromName ?? '',
      smtpSecure: company?.smtpSecure ?? false,
    },
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');

  useEffect(() => {
    if (company) {
      reset({
        smtpHost: company.smtpHost ?? '',
        smtpPort: company.smtpPort ?? 587,
        smtpUser: company.smtpUser ?? '',
        smtpPass: '',
        smtpFromName: company.smtpFromName ?? '',
        smtpSecure: company.smtpSecure ?? false,
      });
    }
  }, [company]);

  async function onSubmit(vals: any) {
    setSaving(true);
    try {
      const { data } = await api.put('/settings/smtp', vals);
      onSave(data);
      toast.success('Configuración SMTP guardada');
    } catch {
      toast.error('Error al guardar SMTP');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!testEmail) { toast.error('Ingrese un email de destino'); return; }
    setTesting(true);
    try {
      const { data } = await api.post('/settings/smtp/test', { to: testEmail });
      toast.success(data.message);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al enviar email de prueba');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Configuración de correo electrónico
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Servidor SMTP *</label>
              <Input {...register('smtpHost')} placeholder="smtp.gmail.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Puerto *</label>
              <Input {...register('smtpPort')} type="number" placeholder="587" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Usuario</label>
              <Input {...register('smtpUser')} type="email" placeholder="noreply@empresa.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Contraseña
                {company?.smtpUser && (
                  <span className="ml-1 text-xs text-slate-400 font-normal">(dejar vacío para no cambiar)</span>
                )}
              </label>
              <Input {...register('smtpPass')} type="password" placeholder="••••••••" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nombre del remitente</label>
              <Input {...register('smtpFromName')} placeholder="Gestión de Mantenimiento" />
            </div>
            <div className="flex items-center gap-3 pt-5">
              <input
                {...register('smtpSecure')}
                id="smtpSecure"
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
              />
              <label htmlFor="smtpSecure" className="text-sm font-medium cursor-pointer">
                SSL/TLS (puerto 465)
              </label>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>Guardar configuración</Button>
          </div>
        </form>

        <div className="border-t pt-4">
          <p className="text-sm font-medium text-slate-700 mb-3">Enviar email de prueba</p>
          <div className="flex gap-2">
            <Input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="destinatario@empresa.com"
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={sendTest}
              loading={testing}
              disabled={!company?.smtpUser}
            >
              <SendHorizonal className="h-4 w-4" />
              Probar
            </Button>
          </div>
          {!company?.smtpUser && (
            <p className="text-xs text-slate-400 mt-1">Guarde la configuración SMTP antes de probar</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Checklist Templates ──────────────────────────────────────────────────────

interface ChecklistItem { id: string; item: string; required: boolean; }
interface ChecklistTemplate { id: string; name: string; description?: string; category?: string; items: ChecklistItem[]; active: boolean; }

function ChecklistsTab() {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistTemplate | null>(null);

  useEffect(() => {
    api.get('/checklist-templates/all')
      .then(({ data }) => setTemplates(data))
      .catch(() => toast.error('Error al cargar plantillas'))
      .finally(() => setLoading(false));
  }, []);

  function openNew() { setEditing(null); setDialogOpen(true); }
  function openEdit(t: ChecklistTemplate) { setEditing(t); setDialogOpen(true); }

  async function toggleActive(t: ChecklistTemplate) {
    await api.put(`/checklist-templates/${t.id}`, { active: !t.active });
    setTemplates(ts => ts.map(x => x.id === t.id ? { ...x, active: !x.active } : x));
  }

  function onSaved(t: ChecklistTemplate) {
    setTemplates(ts => editing ? ts.map(x => x.id === t.id ? t : x) : [t, ...ts]);
    setDialogOpen(false);
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-700">Plantillas de Checklist</p>
          <p className="text-xs text-slate-500">Defina listas estándar reutilizables por tipo de equipo</p>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Nueva plantilla</Button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm border rounded-lg">
          No hay plantillas. Cree la primera.
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <Card key={t.id} className={cn('border', !t.active && 'opacity-60')}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-800">{t.name}</p>
                      {t.category && (
                        <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">{t.category}</span>
                      )}
                      {!t.active && <span className="text-xs text-slate-400">(inactiva)</span>}
                    </div>
                    {t.description && <p className="text-sm text-slate-500 mt-0.5">{t.description}</p>}
                    <p className="text-xs text-slate-400 mt-1">{(t.items as ChecklistItem[]).length} ítems</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(t)}>
                      <Power className={cn('h-3.5 w-3.5', t.active ? 'text-green-500' : 'text-slate-400')} />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? 'Editar plantilla' : 'Nueva plantilla de checklist'}>
        <ChecklistTemplateForm template={editing} onSaved={onSaved} onClose={() => setDialogOpen(false)} />
      </Dialog>
    </div>
  );
}

function ChecklistTemplateForm({ template, onSaved, onClose }: {
  template: ChecklistTemplate | null;
  onSaved: (t: ChecklistTemplate) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [category, setCategory] = useState(template?.category ?? '');
  const [items, setItems] = useState<ChecklistItem[]>(
    template?.items ?? []
  );
  const [newItem, setNewItem] = useState('');
  const [saving, setSaving] = useState(false);

  function addItem() {
    const text = newItem.trim();
    if (!text) return;
    setItems(prev => [...prev, { id: Date.now().toString(), item: text, required: true }]);
    setNewItem('');
  }

  function removeItem(id: string) { setItems(prev => prev.filter(i => i.id !== id)); }
  function toggleRequired(id: string) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, required: !i.required } : i));
  }

  async function save() {
    if (!name.trim()) { toast.error('El nombre es requerido'); return; }
    if (items.length === 0) { toast.error('Agrega al menos un ítem'); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), description: description.trim() || undefined, category: category.trim() || undefined, items };
      const { data } = template
        ? await api.put(`/checklist-templates/${template.id}`, payload)
        : await api.post('/checklist-templates', payload);
      onSaved(data);
      toast.success(template ? 'Plantilla actualizada' : 'Plantilla creada');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-4 max-w-lg w-full">
      <p className="font-semibold text-slate-800">{template ? 'Editar plantilla' : 'Nueva plantilla'}</p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Nombre *</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Aire Acondicionado" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Categoría</label>
            <Input value={category} onChange={e => setCategory(e.target.value)} placeholder="HVAC, Eléctrico..." />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Descripción</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Breve descripción" />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Ítems del checklist</label>
          <div className="flex gap-2">
            <Input
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              placeholder="Nuevo ítem..."
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem())}
            />
            <Button type="button" variant="outline" size="sm" onClick={addItem}><Plus className="h-4 w-4" /></Button>
          </div>
          {items.length > 0 && (
            <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
              {items.map((item, idx) => (
                <div key={item.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="text-xs text-slate-400 w-5">{idx + 1}.</span>
                  <span className="flex-1 text-sm text-slate-700">{item.item}</span>
                  <button
                    type="button"
                    onClick={() => toggleRequired(item.id)}
                    className={cn('text-xs px-1.5 py-0.5 rounded', item.required ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500')}
                  >
                    {item.required ? 'Req.' : 'Opc.'}
                  </button>
                  <button type="button" onClick={() => removeItem(item.id)} className="text-slate-400 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={save} loading={saving}>Guardar</Button>
      </div>
    </div>
  );
}
