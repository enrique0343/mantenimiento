import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ClipboardCheck, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { MaintenancePlan, Branch } from '@/types';
import { FREQUENCY_LABEL, formatDate, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAuthStore } from '@/store/auth.store';

function DueBadge({ date }: { date: string }) {
  const ms = new Date(date).getTime() - Date.now();
  const days = ms / (1000 * 60 * 60 * 24);
  if (ms < 0) return <span className="flex items-center gap-1 text-xs font-medium text-red-600"><AlertTriangle className="h-3 w-3" /> Vencido</span>;
  if (days <= 7) return <span className="text-xs font-medium text-amber-600">⚠ {Math.ceil(days)}d</span>;
  return <span className="text-xs text-slate-500">{formatDate(date)}</span>;
}

export default function MaintenancePlanList() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canEdit = ['ADMIN', 'MAINTENANCE_CHIEF'].includes(user?.role ?? '');

  const [items, setItems] = useState<MaintenancePlan[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterActive, setFilterActive] = useState('true');
  const [page, setPage] = useState(1);
  const LIMIT = 25;

  useEffect(() => {
    api.get('/branches').then(({ data }) => setBranches(data)).catch(() => {});
  }, []);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('active', filterActive);
      if (filterBranch) params.set('branchId', filterBranch);
      params.set('page', String(page));
      params.set('limit', String(LIMIT));
      const { data } = await api.get(`/maintenance-plans?${params}`);
      // Client-side search since backend doesn't support text search on plans
      const all: MaintenancePlan[] = data.data;
      const filtered = search
        ? all.filter(p =>
            (p as any).equipment?.name?.toLowerCase().includes(search.toLowerCase()) ||
            (p as any).equipment?.code?.toLowerCase().includes(search.toLowerCase()) ||
            (p as any).name?.toLowerCase().includes(search.toLowerCase())
          )
        : all;
      setItems(filtered);
      setTotal(data.total);
    } catch {
      toast.error('Error al cargar los planes');
    } finally {
      setLoading(false);
    }
  }, [filterBranch, filterActive, page, search]);

  useEffect(() => { setPage(1); }, [filterBranch, filterActive, search]);
  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  async function toggleActive(plan: MaintenancePlan) {
    try {
      if (plan.active) {
        await api.delete(`/maintenance-plans/${plan.id}`);
        toast.success('Plan desactivado');
      } else {
        await api.put(`/maintenance-plans/${plan.id}`, { active: true });
        toast.success('Plan activado');
      }
      fetchPlans();
    } catch {
      toast.error('Error al actualizar el plan');
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-800">Planes de Mantenimiento</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{total}</span>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => navigate('/planes/nuevo')}>
            <Plus className="h-4 w-4" />
            Nuevo plan
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por equipo o nombre del plan..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={filterBranch}
          onChange={(e) => setFilterBranch(e.target.value)}
          placeholder="Sucursal"
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          className="w-44"
        />
        <Select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value)}
          options={[
            { value: 'true', label: 'Activos' },
            { value: 'false', label: 'Inactivos' },
          ]}
          className="w-32"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
                <th className="px-4 py-3">Equipo</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Frecuencia</th>
                <th className="px-4 py-3">Próximo vencimiento</th>
                <th className="px-4 py-3">Asignado a</th>
                <th className="px-4 py-3">Checklist</th>
                {canEdit && <th className="px-4 py-3 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent inline-block" />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <ClipboardCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No se encontraron planes de mantenimiento</p>
                    {canEdit && (
                      <Button size="sm" className="mt-3" onClick={() => navigate('/planes/nuevo')}>
                        Crear primer plan
                      </Button>
                    )}
                  </td>
                </tr>
              ) : (
                items.map((plan) => (
                  <tr key={plan.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 truncate max-w-[180px]">
                        {(plan as any).equipment?.name ?? '—'}
                      </p>
                      <p className="text-xs text-slate-400 font-mono">{(plan as any).equipment?.code}</p>
                      <p className="text-xs text-slate-400">
                        {(plan as any).equipment?.location?.branch?.name}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-700">{(plan as any).name}</p>
                      {!plan.active && (
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <XCircle className="h-3 w-3" /> Inactivo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-xs font-medium">
                        {FREQUENCY_LABEL[plan.frequency]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <DueBadge date={plan.nextDueDate} />
                      {plan.lastExecutedDate && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          Último: {formatDate(plan.lastExecutedDate)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {(plan as any).assignedUser?.name ?? (plan as any).assignedProvider?.name ?? (
                        <span className="text-slate-300">Sin asignar</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {Array.isArray(plan.checklistTemplate) ? (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          {(plan.checklistTemplate as any[]).length} ítems
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate(`/planes/${plan.id}/editar`)}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleActive(plan)}
                            className={cn(plan.active ? 'text-red-500 hover:bg-red-50' : 'text-green-600 hover:bg-green-50')}
                          >
                            {plan.active ? 'Desactivar' : 'Activar'}
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-slate-500">
            <span>{total} planes en total</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
              <span className="flex items-center px-3 text-xs">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
