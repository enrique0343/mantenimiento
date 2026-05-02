import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Package, AlertTriangle, History, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '@/lib/api';
import type { SparePart, SparePartStock, Branch } from '@/types';
import { formatDateTime, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth.store';

const MOVEMENT_LABEL: Record<string, string> = {
  IN: 'Entrada',
  OUT: 'Salida',
  ADJUSTMENT: 'Ajuste',
  RETURN: 'Devolución',
};
const MOVEMENT_COLOR: Record<string, string> = {
  IN: 'text-green-600',
  OUT: 'text-red-500',
  ADJUSTMENT: 'text-blue-600',
  RETURN: 'text-purple-600',
};

const partSchema = z.object({
  code: z.string().min(1, 'Código requerido'),
  name: z.string().min(2, 'Nombre requerido'),
  description: z.string().optional(),
  unit: z.string().min(1, 'Unidad requerida'),
  category: z.string().optional(),
});
type PartForm = z.infer<typeof partSchema>;

interface StockAlert extends SparePartStock {
  sparePart: { id: string; name: string; code: string; unit: string };
  branch: { name: string };
}

export default function Inventory() {
  const { user } = useAuthStore();
  const canEdit = ['ADMIN', 'MAINTENANCE_CHIEF'].includes(user?.role ?? '');
  const canAdjust = ['ADMIN', 'MAINTENANCE_CHIEF', 'TECHNICIAN'].includes(user?.role ?? '');

  const [tab, setTab] = useState<'catalog' | 'alerts'>('catalog');
  const [parts, setParts] = useState<SparePart[]>([]);
  const [alertItems, setAlertItems] = useState<StockAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [filterBranch, setFilterBranch] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 30;

  // Part form dialog
  const [showPartDialog, setShowPartDialog] = useState(false);
  const [editingPart, setEditingPart] = useState<SparePart | null>(null);
  const [savingPart, setSavingPart] = useState(false);

  // Stock adjust dialog
  const [showStockDialog, setShowStockDialog] = useState(false);
  const [stockPart, setStockPart] = useState<SparePart | null>(null);
  const [stockBranchId, setStockBranchId] = useState('');
  const [stockQty, setStockQty] = useState('');
  const [stockType, setStockType] = useState('ADJUSTMENT');
  const [stockNotes, setStockNotes] = useState('');
  const [savingStock, setSavingStock] = useState(false);

  // Movements dialog
  const [showMovDialog, setShowMovDialog] = useState(false);
  const [movPart, setMovPart] = useState<SparePart | null>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [loadingMovs, setLoadingMovs] = useState(false);

  // Min stock dialog
  const [showMinDialog, setShowMinDialog] = useState(false);
  const [minPart, setMinPart] = useState<SparePart | null>(null);
  const [minBranchId, setMinBranchId] = useState('');
  const [minQty, setMinQty] = useState('');
  const [savingMin, setSavingMin] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PartForm>({
    resolver: zodResolver(partSchema),
  });

  useEffect(() => {
    api.get('/branches').then(({ data }) => setBranches(data)).catch(() => {});
  }, []);

  const fetchParts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterBranch) params.set('branchId', filterBranch);
      params.set('page', String(page));
      params.set('limit', String(LIMIT));
      const { data } = await api.get(`/spare-parts?${params}`);
      setParts(data.data);
      setTotal(data.total);
    } catch {
      toast.error('Error al cargar repuestos');
    } finally {
      setLoading(false);
    }
  }, [search, filterBranch, page]);

  const fetchAlerts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterBranch) params.set('branchId', filterBranch);
      const { data } = await api.get(`/spare-parts/alerts?${params}`);
      setAlertItems(data);
    } catch { /* non-critical */ }
  }, [filterBranch]);

  useEffect(() => { setPage(1); }, [search, filterBranch]);
  useEffect(() => { fetchParts(); fetchAlerts(); }, [fetchParts, fetchAlerts]);

  function openCreatePart() {
    setEditingPart(null);
    reset({ code: '', name: '', description: '', unit: '', category: '' });
    setShowPartDialog(true);
  }

  function openEditPart(part: SparePart) {
    setEditingPart(part);
    reset({ code: part.code, name: part.name, description: part.description ?? '', unit: part.unit, category: part.category ?? '' });
    setShowPartDialog(true);
  }

  async function savePart(data: PartForm) {
    setSavingPart(true);
    try {
      if (editingPart) {
        await api.put(`/spare-parts/${editingPart.id}`, data);
        toast.success('Repuesto actualizado');
      } else {
        await api.post('/spare-parts', data);
        toast.success('Repuesto creado');
      }
      setShowPartDialog(false);
      fetchParts();
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al guardar');
    } finally {
      setSavingPart(false);
    }
  }

  function openStockAdjust(part: SparePart) {
    setStockPart(part);
    setStockBranchId(filterBranch || branches[0]?.id || '');
    setStockQty('');
    setStockType('ADJUSTMENT');
    setStockNotes('');
    setShowStockDialog(true);
  }

  async function saveStockAdjust() {
    if (!stockPart || !stockBranchId || !stockQty) return;
    setSavingStock(true);
    try {
      await api.patch(`/spare-parts/${stockPart.id}/stock`, {
        branchId: stockBranchId,
        quantity: parseInt(stockQty),
        type: stockType,
        notes: stockNotes,
      });
      toast.success('Stock ajustado');
      setShowStockDialog(false);
      fetchParts();
      fetchAlerts();
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al ajustar stock');
    } finally {
      setSavingStock(false);
    }
  }

  async function openMovements(part: SparePart) {
    setMovPart(part);
    setShowMovDialog(true);
    setLoadingMovs(true);
    try {
      const params = new URLSearchParams();
      if (filterBranch) params.set('branchId', filterBranch);
      const { data } = await api.get(`/spare-parts/${part.id}/movements?${params}`);
      setMovements(data.data);
    } catch {
      toast.error('Error al cargar movimientos');
    } finally {
      setLoadingMovs(false);
    }
  }

  function openMinStock(part: SparePart) {
    setMinPart(part);
    setMinBranchId(filterBranch || branches[0]?.id || '');
    const currentMin = part.stocks?.find(s => s.branchId === (filterBranch || branches[0]?.id))?.minStock ?? 0;
    setMinQty(String(currentMin));
    setShowMinDialog(true);
  }

  async function saveMinStock() {
    if (!minPart || !minBranchId) return;
    setSavingMin(true);
    try {
      await api.patch(`/spare-parts/${minPart.id}/min-stock`, { branchId: minBranchId, minStock: parseInt(minQty) || 0 });
      toast.success('Stock mínimo actualizado');
      setShowMinDialog(false);
      fetchParts();
      fetchAlerts();
    } catch {
      toast.error('Error al actualizar stock mínimo');
    } finally {
      setSavingMin(false);
    }
  }

  function getStockForBranch(part: SparePart): SparePartStock | undefined {
    if (!part.stocks) return undefined;
    if (filterBranch) return part.stocks.find(s => s.branchId === filterBranch);
    return part.stocks[0];
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-800">Inventario de Repuestos</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{total}</span>
        </div>
        {canEdit && (
          <Button size="sm" onClick={openCreatePart}>
            <Plus className="h-4 w-4" /> Nuevo repuesto
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { value: 'catalog', label: 'Catálogo' },
          { value: 'alerts', label: 'Stock bajo', badge: alertItems.length },
        ].map(({ value, label, badge }) => (
          <button
            key={value}
            onClick={() => setTab(value as any)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === value ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            {label}
            {badge != null && badge > 0 && (
              <span className="rounded-full bg-red-100 text-red-700 px-1.5 py-0.5 text-xs font-bold">{badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por código o nombre..."
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
          className="w-52"
        />
      </div>

      {/* Catalog tab */}
      {tab === 'catalog' && (
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Repuesto</th>
                  <th className="px-4 py-3">Categoría</th>
                  <th className="px-4 py-3">Unidad</th>
                  <th className="px-4 py-3 text-center">Stock</th>
                  <th className="px-4 py-3 text-center">Mínimo</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={7} className="py-12 text-center">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent inline-block" />
                  </td></tr>
                ) : parts.length === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center text-slate-400">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No se encontraron repuestos</p>
                    {canEdit && <Button size="sm" className="mt-3" onClick={openCreatePart}>Agregar primero</Button>}
                  </td></tr>
                ) : (
                  parts.map((part) => {
                    const stock = getStockForBranch(part);
                    const isLow = stock && stock.minStock > 0 && stock.quantity <= stock.minStock;
                    return (
                      <tr key={part.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs font-bold text-slate-600">{part.code}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{part.name}</p>
                          {part.description && <p className="text-xs text-slate-400">{part.description}</p>}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{part.category ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{part.unit}</td>
                        <td className="px-4 py-3 text-center">
                          {stock !== undefined ? (
                            <span className={cn('font-bold text-sm', isLow ? 'text-red-600' : 'text-slate-700')}>
                              {stock.quantity}
                              {isLow && <AlertTriangle className="h-3 w-3 inline ml-1" />}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-slate-400">
                          {stock?.minStock ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end">
                            <Button variant="outline" size="sm" onClick={() => openMovements(part)} title="Historial">
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            {canAdjust && (
                              <Button variant="outline" size="sm" onClick={() => openStockAdjust(part)}>
                                Ajustar
                              </Button>
                            )}
                            {canEdit && (
                              <>
                                <Button variant="outline" size="sm" onClick={() => openMinStock(part)}>
                                  Mín.
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => openEditPart(part)}>
                                  Editar
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-slate-500">
              <span>{total} repuestos</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                <span className="flex items-center px-3 text-xs">{page} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Alerts tab */}
      {tab === 'alerts' && (
        <div className="space-y-3">
          {alertItems.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-slate-400">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>No hay alertas de stock bajo</p>
              </CardContent>
            </Card>
          ) : (
            alertItems.map((s) => (
              <Card key={s.id} className="border-red-200 bg-red-50">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        <p className="font-medium text-slate-800">{s.sparePart.name}</p>
                        <span className="font-mono text-xs text-slate-400">{s.sparePart.code}</span>
                      </div>
                      <p className="text-sm text-slate-500 mt-0.5">
                        {s.branch.name} · Unidad: {s.sparePart.unit}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-red-600">{s.quantity}</p>
                      <p className="text-xs text-slate-400">Mínimo: {s.minStock}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Create/Edit part dialog */}
      <Dialog
        open={showPartDialog}
        onClose={() => setShowPartDialog(false)}
        title={editingPart ? 'Editar repuesto' : 'Nuevo repuesto'}
      >
        <form onSubmit={handleSubmit(savePart)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Código *</Label>
              <Input {...register('code')} placeholder="REP-001" disabled={!!editingPart} />
              {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Unidad *</Label>
              <Input {...register('unit')} placeholder="unidad, metros, litros..." />
              {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Nombre *</Label>
              <Input {...register('name')} placeholder="Nombre descriptivo del repuesto" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Input {...register('category')} placeholder="Filtros, lubricantes..." />
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Input {...register('description')} placeholder="Descripción breve..." />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowPartDialog(false)}>Cancelar</Button>
            <Button type="submit" loading={savingPart}>
              <Save className="h-4 w-4" />{editingPart ? 'Guardar' : 'Crear'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Stock adjust dialog */}
      <Dialog
        open={showStockDialog}
        onClose={() => setShowStockDialog(false)}
        title={`Ajustar stock — ${stockPart?.name}`}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Sucursal</Label>
            <Select
              value={stockBranchId}
              onChange={(e) => setStockBranchId(e.target.value)}
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo de movimiento</Label>
              <Select
                value={stockType}
                onChange={(e) => setStockType(e.target.value)}
                options={[
                  { value: 'IN', label: 'Entrada (+)' },
                  { value: 'OUT', label: 'Salida (-)' },
                  { value: 'ADJUSTMENT', label: 'Ajuste' },
                  { value: 'RETURN', label: 'Devolución' },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cantidad</Label>
              <Input
                type="number"
                min={0}
                value={stockQty}
                onChange={(e) => setStockQty(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Input value={stockNotes} onChange={(e) => setStockNotes(e.target.value)} placeholder="Motivo del ajuste..." />
          </div>
          <p className="text-xs text-slate-400">
            {stockType === 'OUT' ? 'Se restará del stock actual' : 'Se sumará al stock actual'}
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowStockDialog(false)}>Cancelar</Button>
            <Button onClick={saveStockAdjust} loading={savingStock} disabled={!stockBranchId || !stockQty}>
              Confirmar
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Min stock dialog */}
      <Dialog
        open={showMinDialog}
        onClose={() => setShowMinDialog(false)}
        title={`Stock mínimo — ${minPart?.name}`}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Sucursal</Label>
            <Select
              value={minBranchId}
              onChange={(e) => setMinBranchId(e.target.value)}
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Cantidad mínima</Label>
            <Input type="number" min={0} value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="5" />
            <p className="text-xs text-slate-400">Se enviará alerta cuando el stock llegue a este nivel</p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowMinDialog(false)}>Cancelar</Button>
            <Button onClick={saveMinStock} loading={savingMin}>
              <Save className="h-4 w-4" /> Guardar
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Movements dialog */}
      <Dialog
        open={showMovDialog}
        onClose={() => setShowMovDialog(false)}
        title={`Movimientos — ${movPart?.name}`}
      >
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {loadingMovs ? (
            <div className="py-8 text-center">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent inline-block" />
            </div>
          ) : movements.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">Sin movimientos registrados</p>
          ) : (
            movements.map((m) => (
              <div key={m.id} className="flex items-start justify-between border-b pb-2 last:border-0">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-bold', MOVEMENT_COLOR[m.type])}>
                      {MOVEMENT_LABEL[m.type]}
                    </span>
                    <span className="text-xs text-slate-400">{m.createdBy?.name}</span>
                  </div>
                  {m.notes && <p className="text-xs text-slate-500 mt-0.5">{m.notes}</p>}
                  <p className="text-xs text-slate-400">{formatDateTime(m.createdAt)}</p>
                </div>
                <span className={cn('font-bold', MOVEMENT_COLOR[m.type])}>
                  {m.type === 'OUT' ? '-' : '+'}{m.quantity}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="flex justify-end mt-3">
          <Button variant="outline" onClick={() => setShowMovDialog(false)}>Cerrar</Button>
        </div>
      </Dialog>
    </div>
  );
}
