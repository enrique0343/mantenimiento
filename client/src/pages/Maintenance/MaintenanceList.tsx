import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { WorkOrder, Branch } from '@/types';
import {
  WO_STATUS_LABEL, WO_STATUS_COLOR, WO_TYPE_LABEL, PRIORITY_LABEL,
  PRIORITY_COLOR, formatDate, cn,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const TABS = [
  { label: 'Todas', value: '' },
  { label: 'Abiertas', value: 'OPEN' },
  { label: 'En progreso', value: 'IN_PROGRESS' },
  { label: 'Completadas', value: 'COMPLETED' },
  { label: 'Verificadas', value: 'VERIFIED' },
  { label: 'Cerradas', value: 'CLOSED' },
];

const TYPE_COLOR: Record<string, string> = {
  PREVENTIVE: 'bg-green-100 text-green-800',
  CORRECTIVE: 'bg-red-100 text-red-800',
  PREDICTIVE: 'bg-purple-100 text-purple-800',
};

export default function MaintenanceList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WorkOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);

  const [tab, setTab] = useState('');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 25;

  useEffect(() => {
    api.get('/branches').then(({ data }) => setBranches(data)).catch(() => {});
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab) params.set('status', tab);
      if (search) params.set('search', search);
      if (filterType) params.set('type', filterType);
      if (filterBranch) params.set('branchId', filterBranch);
      if (filterPriority) params.set('priority', filterPriority);
      params.set('page', String(page));
      params.set('limit', String(LIMIT));

      const { data } = await api.get(`/work-orders?${params}`);
      setItems(data.data);
      setTotal(data.total);
    } catch {
      toast.error('Error al cargar las órdenes de trabajo');
    } finally {
      setLoading(false);
    }
  }, [tab, search, filterType, filterBranch, filterPriority, page]);

  useEffect(() => { setPage(1); }, [tab, search, filterType, filterBranch, filterPriority]);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-800">Órdenes de Trabajo</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{total}</span>
        </div>
        <Button size="sm" onClick={() => navigate('/mantenimiento/nuevo')}>
          <Plus className="h-4 w-4" />
          Nueva OT
        </Button>
      </div>

      {/* Tabs de estado */}
      <div className="flex gap-1 overflow-x-auto border-b pb-0">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              'shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.value
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por código o equipo..."
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
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          placeholder="Tipo"
          options={[
            { value: 'PREVENTIVE', label: 'Preventivo' },
            { value: 'CORRECTIVE', label: 'Correctivo' },
            { value: 'PREDICTIVE', label: 'Predictivo' },
          ]}
          className="w-36"
        />
        <Select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          placeholder="Prioridad"
          options={[
            { value: 'CRITICAL', label: 'Crítica' },
            { value: 'HIGH', label: 'Alta' },
            { value: 'MEDIUM', label: 'Media' },
            { value: 'LOW', label: 'Baja' },
          ]}
          className="w-32"
        />
      </div>

      {/* Tabla */}
      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
                <th className="px-4 py-3">OT</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Equipo</th>
                <th className="px-4 py-3">Prioridad</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Técnico</th>
                <th className="px-4 py-3">Fecha prog.</th>
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
                    <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No se encontraron órdenes de trabajo</p>
                  </td>
                </tr>
              ) : (
                items.map((wo) => (
                  <tr
                    key={wo.id}
                    onClick={() => navigate(`/mantenimiento/${wo.id}`)}
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-bold text-slate-700">{wo.code}</td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TYPE_COLOR[wo.type])}>
                        {WO_TYPE_LABEL[wo.type]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 truncate max-w-[200px]">
                        {(wo as any).equipment?.name ?? '—'}
                      </p>
                      <p className="text-xs text-slate-400 font-mono">
                        {(wo as any).equipment?.code}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', PRIORITY_COLOR[wo.priority])}>
                        {PRIORITY_LABEL[wo.priority]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', WO_STATUS_COLOR[wo.status])}>
                        {WO_STATUS_LABEL[wo.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {(wo as any).technician?.name ?? (wo as any).provider?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {formatDate(wo.scheduledDate)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-slate-500">
            <span>{total} órdenes en total</span>
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
