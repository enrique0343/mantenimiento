import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck, AlertTriangle, CheckCircle2, Clock, ChevronLeft,
  ChevronRight, User, Truck, Filter, RefreshCw,
} from 'lucide-react';
import { format, startOfWeek, addWeeks, addDays, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import type { Branch } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProgramStatus = 'DONE' | 'IN_PROGRESS' | 'OVERDUE' | 'PENDING';

interface ProgramWO {
  id: string;
  code: string;
  status: string;
  programStatus: ProgramStatus;
  scheduledDate: string;
  delayDays: number;
  estimatedHours: number | null;
  notes: string | null;
  equipment: { id: string; name: string; code: string; location?: { area: string; branch?: { name: string } } } | null;
  technician: { id: string; name: string } | null;
  provider: { id: string; name: string } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ProgramStatus, { label: string; color: string; icon: React.ElementType }> = {
  DONE:        { label: 'Completado',  color: 'bg-green-100 text-green-800 border-green-200',  icon: CheckCircle2 },
  IN_PROGRESS: { label: 'En ejecución',color: 'bg-blue-100 text-blue-800 border-blue-200',    icon: Clock },
  OVERDUE:     { label: 'Atrasado',   color: 'bg-red-100 text-red-800 border-red-200',        icon: AlertTriangle },
  PENDING:     { label: 'Pendiente',  color: 'bg-slate-100 text-slate-700 border-slate-200',  icon: CalendarCheck },
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MaintenanceProgram() {
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [viewMode, setViewMode] = useState<'week' | 'month' | 'list'>('week');
  const [wos, setWos] = useState<ProgramWO[]>([]);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [technicians, setTechnicians] = useState<{ id: string; name: string }[]>([]);
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterTech, setFilterTech] = useState('');

  // Quick assign dialog
  const [assignWO, setAssignWO] = useState<ProgramWO | null>(null);
  const [assignTechId, setAssignTechId] = useState('');
  const [assignProviderId, setAssignProviderId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/branches').then(({ data }) => setBranches(data)).catch(() => {});
    api.get('/users?role=TECHNICIAN&role=ADMIN&role=MAINTENANCE_CHIEF').then(({ data }) => setTechnicians(data.data ?? data)).catch(() => {});
    api.get('/providers').then(({ data }) => setProviders(Array.isArray(data) ? data : data.data ?? [])).catch(() => {});
  }, []);

  const from = viewMode === 'week'
    ? weekStart
    : new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
  const to = viewMode === 'week'
    ? addDays(weekStart, 6)
    : new Date(weekStart.getFullYear(), weekStart.getMonth() + 1, 0);

  const fetchProgram = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: from.toISOString(),
        to:   to.toISOString(),
      });
      if (filterBranch) params.set('branchId', filterBranch);
      if (filterTech)   params.set('technicianId', filterTech);
      const { data } = await api.get(`/work-orders/program?${params}`);
      setWos(data);
    } catch {
      toast.error('Error al cargar el programa');
    } finally {
      setLoading(false);
    }
  }, [weekStart, viewMode, filterBranch, filterTech]);

  useEffect(() => { fetchProgram(); }, [fetchProgram]);

  function prev() {
    setWeekStart(d => viewMode === 'week' ? addWeeks(d, -1) : new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function next() {
    setWeekStart(d => viewMode === 'week' ? addWeeks(d, 1) : new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  function openAssign(wo: ProgramWO) {
    setAssignWO(wo);
    setAssignTechId(wo.technician?.id ?? '');
    setAssignProviderId(wo.provider?.id ?? '');
  }

  async function saveAssign() {
    if (!assignWO) return;
    setSaving(true);
    try {
      await api.patch(`/work-orders/${assignWO.id}/quick-assign`, {
        technicianId: assignTechId || null,
        providerId:   assignProviderId || null,
      });
      toast.success('Asignación guardada');
      setAssignWO(null);
      fetchProgram();
    } catch {
      toast.error('Error al guardar asignación');
    } finally {
      setSaving(false);
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = {
    total:       wos.length,
    done:        wos.filter(w => w.programStatus === 'DONE').length,
    inProgress:  wos.filter(w => w.programStatus === 'IN_PROGRESS').length,
    overdue:     wos.filter(w => w.programStatus === 'OVERDUE').length,
    unassigned:  wos.filter(w => !w.technician && !w.provider && w.programStatus !== 'DONE').length,
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-800">Programa de Mantenimiento</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={filterBranch}
            onChange={e => setFilterBranch(e.target.value)}
            placeholder="Todas las sucursales"
            options={branches.map(b => ({ value: b.id, label: b.name }))}
            className="w-44"
          />
          <Select
            value={filterTech}
            onChange={e => setFilterTech(e.target.value)}
            placeholder="Todos los técnicos"
            options={technicians.map(t => ({ value: t.id, label: t.name }))}
            className="w-44"
          />
          <Button variant="outline" size="sm" onClick={fetchProgram} loading={loading}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: 'Total',        value: stats.total,      color: 'text-slate-700' },
          { label: 'Completados',  value: stats.done,       color: 'text-green-700' },
          { label: 'En ejecución', value: stats.inProgress, color: 'text-blue-700' },
          { label: 'Atrasados',    value: stats.overdue,    color: 'text-red-700' },
          { label: 'Sin asignar',  value: stats.unassigned, color: 'text-amber-700' },
        ].map(s => (
          <div key={s.label} className="bg-white border rounded-lg px-3 py-2 text-center">
            <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Navigation + view toggle */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={prev}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoy</Button>
        <Button variant="outline" size="icon" onClick={next}><ChevronRight className="h-4 w-4" /></Button>
        <span className="text-sm font-medium text-slate-700 mx-2">
          {viewMode === 'week'
            ? `${format(from, 'd MMM', { locale: es })} – ${format(to, 'd MMM yyyy', { locale: es })}`
            : format(from, 'MMMM yyyy', { locale: es })}
        </span>
        <div className="ml-auto flex gap-1">
          {(['week', 'month', 'list'] as const).map(v => (
            <Button key={v} size="sm" variant={viewMode === v ? 'default' : 'outline'} onClick={() => setViewMode(v)}>
              {v === 'week' ? 'Semana' : v === 'month' ? 'Mes' : 'Lista'}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Week view ── */}
      {viewMode === 'week' && (
        <div className="bg-white border rounded-lg overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b">
            {weekDays.map(day => {
              const dayWOs = wos.filter(w => isSameDay(new Date(w.scheduledDate), day));
              const hasOverdue = dayWOs.some(w => w.programStatus === 'OVERDUE');
              return (
                <div key={day.toISOString()} className={cn(
                  'p-2 text-center border-r last:border-r-0',
                  isSameDay(day, new Date()) && 'bg-blue-50',
                )}>
                  <p className="text-xs font-medium text-slate-500 uppercase">{format(day, 'EEE', { locale: es })}</p>
                  <p className={cn('text-lg font-bold', isSameDay(day, new Date()) ? 'text-blue-600' : 'text-slate-700')}>{format(day, 'd')}</p>
                  {dayWOs.length > 0 && (
                    <span className={cn('text-xs rounded-full px-1.5 py-0.5 font-bold', hasOverdue ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600')}>
                      {dayWOs.length}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* Rows */}
          <div className="grid grid-cols-7 min-h-[400px] divide-x">
            {weekDays.map(day => {
              const dayWOs = wos.filter(w => isSameDay(new Date(w.scheduledDate), day));
              return (
                <div key={day.toISOString()} className={cn('p-1.5 space-y-1.5', isSameDay(day, new Date()) && 'bg-blue-50/40')}>
                  {dayWOs.map(wo => <WOCard key={wo.id} wo={wo} onClick={() => navigate(`/mantenimiento/${wo.id}`)} onAssign={() => openAssign(wo)} />)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Month view ── */}
      {viewMode === 'month' && (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, wi) => {
            const weekS = addWeeks(new Date(from.getFullYear(), from.getMonth(), 1 - new Date(from.getFullYear(), from.getMonth(), 1).getDay() + 1), wi);
            const weekWOs = wos.filter(w => {
              const d = new Date(w.scheduledDate);
              return d >= weekS && d < addWeeks(weekS, 1);
            });
            if (!weekWOs.length) return null;
            return (
              <div key={wi} className="bg-white border rounded-lg overflow-hidden">
                <div className="bg-slate-50 border-b px-3 py-1.5 text-xs font-medium text-slate-500">
                  Semana del {format(weekS, 'd')} al {format(addDays(weekS, 6), 'd MMM', { locale: es })}
                  <span className="ml-2 text-slate-400">({weekWOs.length} OTs)</span>
                </div>
                <div className="divide-y">
                  {weekWOs.map(wo => <WORow key={wo.id} wo={wo} onClick={() => navigate(`/mantenimiento/${wo.id}`)} onAssign={() => openAssign(wo)} />)}
                </div>
              </div>
            );
          }).filter(Boolean)}
        </div>
      )}

      {/* ── List view ── */}
      {viewMode === 'list' && (
        <div className="bg-white border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-12 text-center"><span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent inline-block" /></div>
          ) : wos.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">No hay mantenimientos programados en este período</div>
          ) : (
            <div className="divide-y">
              {wos.map(wo => <WORow key={wo.id} wo={wo} onClick={() => navigate(`/mantenimiento/${wo.id}`)} onAssign={() => openAssign(wo)} />)}
            </div>
          )}
        </div>
      )}

      {/* ── Quick assign dialog ── */}
      <Dialog
        open={!!assignWO}
        onClose={() => setAssignWO(null)}
        title={`Asignar — ${assignWO?.equipment?.name ?? assignWO?.code}`}
      >
        <div className="space-y-4">
          <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
            <p><strong>OT:</strong> {assignWO?.code}</p>
            <p><strong>Fecha:</strong> {assignWO?.scheduledDate ? format(new Date(assignWO.scheduledDate), 'dd/MM/yyyy') : '—'}</p>
            <p><strong>Área:</strong> {assignWO?.equipment?.location?.area ?? '—'}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Técnico interno</label>
            <Select
              value={assignTechId}
              onChange={e => { setAssignTechId(e.target.value); if (e.target.value) setAssignProviderId(''); }}
              placeholder="Sin técnico asignado"
              options={technicians.map(t => ({ value: t.id, label: t.name }))}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="flex-1 border-t" /> o <div className="flex-1 border-t" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Proveedor externo</label>
            <Select
              value={assignProviderId}
              onChange={e => { setAssignProviderId(e.target.value); if (e.target.value) setAssignTechId(''); }}
              placeholder="Sin proveedor asignado"
              options={providers.map(p => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setAssignWO(null)}>Cancelar</Button>
            <Button onClick={saveAssign} loading={saving}>Guardar asignación</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProgramStatus }) {
  const { label, color, icon: Icon } = STATUS_CONFIG[status];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full border', color)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function AssignedBadge({ wo }: { wo: ProgramWO }) {
  if (wo.technician) return <span className="flex items-center gap-1 text-xs text-slate-500"><User className="h-3 w-3" />{wo.technician.name}</span>;
  if (wo.provider)   return <span className="flex items-center gap-1 text-xs text-slate-500"><Truck className="h-3 w-3" />{wo.provider.name}</span>;
  return <span className="text-xs text-amber-600 font-medium">Sin asignar</span>;
}

function WOCard({ wo, onClick, onAssign }: { wo: ProgramWO; onClick: () => void; onAssign: () => void }) {
  const { color } = STATUS_CONFIG[wo.programStatus];
  return (
    <div className={cn('rounded border p-1.5 text-xs space-y-1 cursor-pointer hover:shadow-sm transition-shadow', color)} onClick={onClick}>
      <p className="font-bold truncate">{wo.equipment?.name ?? wo.code}</p>
      <p className="text-slate-500 truncate">{wo.equipment?.location?.area}</p>
      <div className="flex items-center justify-between gap-1">
        <AssignedBadge wo={wo} />
        {wo.programStatus !== 'DONE' && (
          <button
            className="text-blue-600 hover:underline font-medium"
            onClick={e => { e.stopPropagation(); onAssign(); }}
          >
            Asignar
          </button>
        )}
      </div>
      {wo.delayDays > 0 && (
        <p className="text-red-600 font-semibold">+{wo.delayDays}d retraso</p>
      )}
    </div>
  );
}

function WORow({ wo, onClick, onAssign }: { wo: ProgramWO; onClick: () => void; onAssign: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer" onClick={onClick}>
      <div className="w-20 shrink-0 text-xs text-slate-500 font-medium">
        {format(new Date(wo.scheduledDate), 'dd/MM', { locale: es })}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-800 truncate">{wo.equipment?.name ?? '—'}</p>
        <p className="text-xs text-slate-400 truncate">
          {wo.equipment?.location?.branch?.name} · {wo.equipment?.location?.area}
        </p>
      </div>
      <div className="shrink-0"><AssignedBadge wo={wo} /></div>
      <div className="shrink-0"><StatusBadge status={wo.programStatus} /></div>
      {wo.delayDays > 0 && (
        <span className="shrink-0 text-xs font-bold text-red-600">+{wo.delayDays}d</span>
      )}
      {wo.programStatus !== 'DONE' && (
        <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); onAssign(); }}>
          <Filter className="h-3.5 w-3.5" /> Asignar
        </Button>
      )}
    </div>
  );
}
