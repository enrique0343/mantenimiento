import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeadphonesIcon, Search, Plus, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import type { HelpdeskTicket, Branch, AuthUser } from '@/types';
import {
  TICKET_STATUS_LABEL, TICKET_STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR,
  formatDate, formatDateTime, cn,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const TABS = [
  { label: 'Todos', value: '' },
  { label: 'Abiertos', value: 'OPEN' },
  { label: 'En progreso', value: 'IN_PROGRESS' },
  { label: 'Escalados', value: 'ESCALATED' },
  { label: 'Resueltos', value: 'RESOLVED' },
  { label: 'Cerrados', value: 'CLOSED' },
];

const REQUEST_TYPE_LABEL: Record<string, string> = {
  EQUIPMENT_FAILURE: 'Falla de equipo',
  MAINTENANCE_REQUEST: 'Solic. mantenimiento',
  OTHER: 'Otro',
};

function SlaIndicator({ deadline, status }: { deadline?: string; status: string }) {
  if (!deadline || status === 'RESOLVED' || status === 'CLOSED') return null;
  const msLeft = new Date(deadline).getTime() - Date.now();
  const hoursLeft = msLeft / (1000 * 60 * 60);

  if (msLeft < 0) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-red-600">
        <AlertTriangle className="h-3 w-3" /> Vencido
      </span>
    );
  }
  if (hoursLeft < 4) {
    return <span className="text-xs font-medium text-amber-600">⚠ {Math.round(hoursLeft)}h restantes</span>;
  }
  return <span className="text-xs text-slate-400">{formatDateTime(deadline)}</span>;
}

export default function HelpdeskList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HelpdeskTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [technicians, setTechnicians] = useState<AuthUser[]>([]);

  const [tab, setTab] = useState('');
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 25;

  useEffect(() => {
    api.get('/branches').then(({ data }) => setBranches(data)).catch(() => {});
    api.get('/users').then(({ data }) => {
      setTechnicians(data.filter((u: AuthUser) => ['TECHNICIAN', 'MAINTENANCE_CHIEF'].includes(u.role)));
    }).catch(() => {});
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab) params.set('status', tab);
      if (search) params.set('search', search);
      if (filterBranch) params.set('branchId', filterBranch);
      if (filterPriority) params.set('priority', filterPriority);
      if (filterAssigned) params.set('assignedToId', filterAssigned);
      params.set('page', String(page));
      params.set('limit', String(LIMIT));
      const { data } = await api.get(`/helpdesk/tickets?${params}`);
      setItems(data.data);
      setTotal(data.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [tab, search, filterBranch, filterPriority, filterAssigned, page]);

  useEffect(() => { setPage(1); }, [tab, search, filterBranch, filterPriority, filterAssigned]);
  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HeadphonesIcon className="h-5 w-5 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-800">Mesa de Ayuda</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{total}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.open('/helpdesk/nuevo', '_blank')}>
          <Plus className="h-4 w-4" />
          Formulario público
        </Button>
      </div>

      {/* Status tabs */}
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

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por código, solicitante..."
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
        <Select
          value={filterAssigned}
          onChange={(e) => setFilterAssigned(e.target.value)}
          placeholder="Asignado a"
          options={[
            { value: 'unassigned', label: 'Sin asignar' },
            ...technicians.map((u) => ({ value: u.id, label: u.name })),
          ]}
          className="w-40"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
                <th className="px-4 py-3">Ticket</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Solicitante</th>
                <th className="px-4 py-3">Sucursal / Área</th>
                <th className="px-4 py-3">Prioridad</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Asignado a</th>
                <th className="px-4 py-3">SLA</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent inline-block" />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <HeadphonesIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No se encontraron tickets</p>
                  </td>
                </tr>
              ) : (
                items.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`/helpdesk/${t.id}`)}
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-bold text-slate-700">
                      {t.code}
                      <p className="text-xs font-normal font-sans text-slate-400">{formatDate(t.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {REQUEST_TYPE_LABEL[t.requestType]}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 text-xs">{t.requesterName}</p>
                      <p className="text-xs text-slate-400">{t.requesterEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      <p>{(t as any).branch?.name ?? '—'}</p>
                      <p className="text-slate-400">{t.area}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', PRIORITY_COLOR[t.priority])}>
                        {PRIORITY_LABEL[t.priority]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TICKET_STATUS_COLOR[t.status])}>
                        {TICKET_STATUS_LABEL[t.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {(t as any).assignedTo?.name ?? <span className="text-slate-300">Sin asignar</span>}
                    </td>
                    <td className="px-4 py-3">
                      <SlaIndicator deadline={t.slaDeadline} status={t.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-slate-500">
            <span>{total} tickets en total</span>
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
