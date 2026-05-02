import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Wrench, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import {
  EQUIPMENT_STATUS_LABEL,
  formatDate, cn,
} from '@/lib/utils';
import type { Equipment as EquipmentType, Branch as BranchType } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

const STATUS_VARIANT: Record<string, any> = {
  ACTIVE: 'success',
  MAINTENANCE: 'warning',
  OUT_OF_SERVICE: 'danger',
  DECOMMISSIONED: 'secondary',
};

export default function EquipmentList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<EquipmentType[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<BranchType[]>([]);

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 25;

  const fetchBranches = useCallback(async () => {
    try {
      const { data } = await api.get('/branches');
      setBranches(data);
    } catch {
      // non-critical
    }
  }, []);

  const fetchEquipments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterType) params.set('type', filterType);
      if (filterStatus) params.set('status', filterStatus);
      if (filterBranch) params.set('branchId', filterBranch);
      params.set('page', String(page));
      params.set('limit', String(LIMIT));

      const { data } = await api.get(`/equipments?${params}`);
      setItems(data.data);
      setTotal(data.total);
    } catch {
      toast.error('Error al cargar los equipos');
    } finally {
      setLoading(false);
    }
  }, [search, filterType, filterStatus, filterBranch, page]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);
  useEffect(() => { setPage(1); }, [search, filterType, filterStatus, filterBranch]);
  useEffect(() => { fetchEquipments(); }, [fetchEquipments]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-800">Equipos</h1>
          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {total}
          </span>
        </div>
        <Button onClick={() => navigate('/equipos/nuevo')} size="sm">
          <Plus className="h-4 w-4" />
          Nuevo equipo
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por nombre, código, serie..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={filterBranch}
          onChange={(e) => setFilterBranch(e.target.value)}
          placeholder="Todas las sucursales"
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          className="w-48"
        />
        <Select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          placeholder="Tipo"
          options={[
            { value: 'GENERAL', label: 'General' },
            { value: 'BIOMEDICAL', label: 'Biomédico' },
          ]}
          className="w-36"
        />
        <Select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          placeholder="Estado"
          options={Object.entries(EQUIPMENT_STATUS_LABEL).map(([v, l]) => ({ value: v, label: l }))}
          className="w-48"
        />
      </div>

      {/* Tabla */}
      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Marca / Modelo</th>
                <th className="px-4 py-3">Ubicación</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    <div className="flex justify-center">
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    <Wrench className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No se encontraron equipos</p>
                  </td>
                </tr>
              ) : (
                items.map((eq) => (
                  <tr
                    key={eq.id}
                    onClick={() => navigate(`/equipos/${eq.id}`)}
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-700">
                      {eq.code}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{eq.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant={eq.type === 'BIOMEDICAL' ? 'info' : 'secondary'}>
                        {eq.type === 'BIOMEDICAL' ? 'Biomédico' : 'General'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {[eq.brand, eq.model].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {eq.location ? (
                        <>
                          <span className="font-medium text-slate-700">
                            {eq.location.branch?.name}
                          </span>
                          {' · '}
                          {eq.location.area}
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[eq.status] ?? 'secondary'}>
                        {EQUIPMENT_STATUS_LABEL[eq.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/equipos/${eq.id}?tab=qr`);
                        }}
                        className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        title="Ver QR"
                      >
                        <QrCode className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-slate-500">
            <span>{total} equipos en total</span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <span className="flex items-center px-3 text-xs">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
