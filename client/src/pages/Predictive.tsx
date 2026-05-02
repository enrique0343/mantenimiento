import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import {
  Activity, AlertTriangle, Plus, Settings2, ClipboardList,
  CheckCircle2, Search,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import api from '@/lib/api';
import type { Equipment } from '@/types';
import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface VariableGroup {
  variable: string;
  unit: string;
  minThreshold: number | null;
  maxThreshold: number | null;
  measurements: {
    id: string; value: number; recordedAt: string; notes?: string;
    recordedBy: { name: string };
  }[];
}

const COMMON_VARIABLES = [
  { label: 'Temperatura', unit: '°C' },
  { label: 'Vibración', unit: 'mm/s' },
  { label: 'Presión', unit: 'bar' },
  { label: 'Corriente', unit: 'A' },
  { label: 'Voltaje', unit: 'V' },
  { label: 'Humedad', unit: '%' },
  { label: 'Ruido', unit: 'dB' },
];

function isInAlert(g: VariableGroup): boolean {
  if (!g.measurements.length) return false;
  const last = g.measurements[g.measurements.length - 1].value;
  return (
    (g.minThreshold !== null && last < g.minThreshold) ||
    (g.maxThreshold !== null && last > g.maxThreshold)
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white shadow-sm p-3 text-xs">
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

export default function Predictive() {
  const navigate = useNavigate();

  // Equipment search
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Equipment[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);

  // Measurements
  const [variables, setVariables] = useState<VariableGroup[]>([]);
  const [loadingVars, setLoadingVars] = useState(false);
  const [selectedVar, setSelectedVar] = useState<string | null>(null);
  const [days, setDays] = useState(90);

  // Dialogs
  const [dialog, setDialog] = useState<'measure' | 'threshold' | null>(null);
  const [saving, setSaving] = useState(false);

  const measureForm = useForm<{
    variable: string; unit: string; value: string; notes: string;
    minThreshold: string; maxThreshold: string;
  }>({ defaultValues: { variable: '', unit: '', value: '', notes: '', minThreshold: '', maxThreshold: '' } });

  const thresholdForm = useForm<{ minThreshold: string; maxThreshold: string }>(
    { defaultValues: { minThreshold: '', maxThreshold: '' } }
  );

  // Equipment search with debounce
  useEffect(() => {
    if (!search || search.length < 2 || selectedEquipment) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/equipments?search=${encodeURIComponent(search)}&limit=8`);
        setSearchResults(Array.isArray(data) ? data : data.data ?? []);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [search, selectedEquipment]);

  const fetchVariables = useCallback(async () => {
    if (!selectedEquipment) return;
    setLoadingVars(true);
    try {
      const { data } = await api.get(`/measurements/${selectedEquipment.id}?days=${days}`);
      setVariables(data);
      if (data.length > 0 && !selectedVar) setSelectedVar(data[0].variable);
    } catch {
      toast.error('Error al cargar mediciones');
    } finally {
      setLoadingVars(false);
    }
  }, [selectedEquipment, days]);

  useEffect(() => { fetchVariables(); }, [fetchVariables]);

  function selectEquipment(eq: Equipment) {
    setSelectedEquipment(eq);
    setSearch(eq.name);
    setSearchResults([]);
    setVariables([]);
    setSelectedVar(null);
  }

  function clearEquipment() {
    setSelectedEquipment(null);
    setSearch('');
    setVariables([]);
    setSelectedVar(null);
  }

  function openMeasure() {
    const current = variables.find((v) => v.variable === selectedVar);
    measureForm.reset({
      variable: selectedVar ?? '',
      unit: current?.unit ?? '',
      value: '',
      notes: '',
      minThreshold: current?.minThreshold?.toString() ?? '',
      maxThreshold: current?.maxThreshold?.toString() ?? '',
    });
    setDialog('measure');
  }

  function openThreshold() {
    const current = variables.find((v) => v.variable === selectedVar);
    thresholdForm.reset({
      minThreshold: current?.minThreshold?.toString() ?? '',
      maxThreshold: current?.maxThreshold?.toString() ?? '',
    });
    setDialog('threshold');
  }

  async function onMeasure(vals: any) {
    if (!selectedEquipment) return;
    setSaving(true);
    try {
      await api.post('/measurements', {
        equipmentId: selectedEquipment.id,
        variable: vals.variable,
        unit: vals.unit,
        value: Number(vals.value),
        notes: vals.notes || undefined,
        minThreshold: vals.minThreshold || undefined,
        maxThreshold: vals.maxThreshold || undefined,
      });
      setSelectedVar(vals.variable);
      setDialog(null);
      toast.success('Medición registrada');
      await fetchVariables();
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al registrar medición');
    } finally {
      setSaving(false);
    }
  }

  async function onThreshold(vals: any) {
    if (!selectedEquipment || !selectedVar) return;
    setSaving(true);
    try {
      const current = variables.find((v) => v.variable === selectedVar);
      await api.put('/measurements/thresholds', {
        equipmentId: selectedEquipment.id,
        variable: selectedVar,
        minThreshold: vals.minThreshold || null,
        maxThreshold: vals.maxThreshold || null,
      });
      setDialog(null);
      toast.success('Umbrales actualizados');
      await fetchVariables();
    } catch {
      toast.error('Error al actualizar umbrales');
    } finally {
      setSaving(false);
    }
  }

  function createCorrectiveWO() {
    if (!selectedEquipment) return;
    navigate('/mantenimiento/nuevo', {
      state: {
        equipmentId: selectedEquipment.id,
        type: 'CORRECTIVE',
        notes: `Alerta predictiva: ${selectedVar} fuera de umbral.`,
      },
    });
  }

  const currentGroup = variables.find((v) => v.variable === selectedVar);
  const alertVars = variables.filter(isInAlert);

  const chartData = currentGroup?.measurements.map((m) => ({
    date: new Date(m.recordedAt).toLocaleDateString('es-CO', { month: '2-digit', day: '2-digit' }),
    value: m.value,
    fullDate: m.recordedAt,
  })) ?? [];

  const inAlert = currentGroup ? isInAlert(currentGroup) : false;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-800">Mantenimiento Predictivo</h1>
        </div>
      </div>

      {/* Equipment selector */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-slate-400 shrink-0" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); if (selectedEquipment) clearEquipment(); }}
                placeholder="Buscar equipo por nombre o código..."
                className="flex-1"
              />
              {selectedEquipment && (
                <button
                  onClick={clearEquipment}
                  className="text-xs text-slate-400 hover:text-red-500 px-2"
                >
                  ×
                </button>
              )}
            </div>
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                {searchResults.map((eq) => (
                  <button
                    key={eq.id}
                    onClick={() => selectEquipment(eq)}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 flex justify-between items-center"
                  >
                    <span className="font-medium">{eq.name}</span>
                    <span className="text-xs text-slate-400 font-mono">{eq.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedEquipment && (
            <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
              <span className="font-medium">{selectedEquipment.name}</span>
              <span className="text-slate-300">·</span>
              <span className="font-mono text-xs text-slate-400">{selectedEquipment.code}</span>
              {alertVars.length > 0 && (
                <span className="ml-auto flex items-center gap-1 text-red-600 text-xs font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {alertVars.length} variable(s) en alerta
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedEquipment && (
        <div className="grid gap-4 lg:grid-cols-4">
          {/* Variables list */}
          <div className="lg:col-span-1 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500 uppercase">Variables</p>
              <Button size="sm" variant="ghost" onClick={openMeasure} className="h-7 text-xs">
                <Plus className="h-3.5 w-3.5" />
                Registrar
              </Button>
            </div>

            {loadingVars ? (
              <div className="flex justify-center py-8">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : variables.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed p-8 text-center">
                <Activity className="h-6 w-6 mx-auto text-slate-300 mb-2" />
                <p className="text-xs text-slate-400">Sin mediciones</p>
                <Button size="sm" className="mt-3 text-xs" onClick={openMeasure}>
                  <Plus className="h-3.5 w-3.5" />
                  Primera medición
                </Button>
              </div>
            ) : (
              variables.map((g) => {
                const alert = isInAlert(g);
                const latest = g.measurements[g.measurements.length - 1];
                return (
                  <button
                    key={g.variable}
                    onClick={() => setSelectedVar(g.variable)}
                    className={cn(
                      'w-full text-left rounded-lg border p-3 transition-colors',
                      selectedVar === g.variable ? 'border-primary bg-blue-50' : 'hover:bg-slate-50',
                      alert && selectedVar !== g.variable && 'border-red-200 bg-red-50'
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-700">{g.variable}</span>
                      {alert
                        ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                        : <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                    </div>
                    {latest ? (
                      <p className={cn('text-lg font-bold', alert ? 'text-red-600' : 'text-slate-800')}>
                        {latest.value} <span className="text-xs font-normal text-slate-400">{g.unit}</span>
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400">Sin datos en {days} días</p>
                    )}
                    {(g.minThreshold !== null || g.maxThreshold !== null) && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {g.minThreshold !== null && `↓${g.minThreshold}`}
                        {g.minThreshold !== null && g.maxThreshold !== null && ' · '}
                        {g.maxThreshold !== null && `↑${g.maxThreshold}`}
                        {' '}{g.unit}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Chart + detail */}
          <div className="lg:col-span-3 space-y-3">
            {currentGroup ? (
              <>
                {/* Alert banner */}
                {inAlert && (
                  <div className="rounded-lg border-2 border-red-200 bg-red-50 p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-red-700">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span className="text-sm font-medium">
                        Valor fuera de umbral — {currentGroup.variable}: {currentGroup.measurements[currentGroup.measurements.length - 1]?.value} {currentGroup.unit}
                      </span>
                    </div>
                    <Button size="sm" onClick={createCorrectiveWO} className="shrink-0 bg-red-600 hover:bg-red-700">
                      <ClipboardList className="h-4 w-4" />
                      Crear OT correctiva
                    </Button>
                  </div>
                )}

                {/* Chart card */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">
                        {currentGroup.variable}
                        <span className="ml-2 text-xs font-normal text-slate-400">({currentGroup.unit})</span>
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <select
                          value={days}
                          onChange={(e) => setDays(Number(e.target.value))}
                          className="text-xs border rounded px-2 py-1 text-slate-600"
                        >
                          <option value={30}>30 días</option>
                          <option value={60}>60 días</option>
                          <option value={90}>90 días</option>
                          <option value={180}>6 meses</option>
                          <option value={365}>1 año</option>
                        </select>
                        <Button size="sm" variant="ghost" onClick={openThreshold} title="Configurar umbrales">
                          <Settings2 className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={openMeasure}>
                          <Plus className="h-4 w-4" />
                          Registrar
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {chartData.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48 text-slate-300">
                        <Activity className="h-8 w-8 mb-2" />
                        <p className="text-sm">Sin mediciones en los últimos {days} días</p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={chartData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip content={<CustomTooltip />} />
                          {currentGroup.minThreshold !== null && (
                            <ReferenceLine
                              y={currentGroup.minThreshold}
                              stroke="#f59e0b"
                              strokeDasharray="4 4"
                              label={{ value: `Mín ${currentGroup.minThreshold}`, position: 'right', fontSize: 10, fill: '#f59e0b' }}
                            />
                          )}
                          {currentGroup.maxThreshold !== null && (
                            <ReferenceLine
                              y={currentGroup.maxThreshold}
                              stroke="#ef4444"
                              strokeDasharray="4 4"
                              label={{ value: `Máx ${currentGroup.maxThreshold}`, position: 'right', fontSize: 10, fill: '#ef4444' }}
                            />
                          )}
                          <Line
                            type="monotone"
                            dataKey="value"
                            name={`${currentGroup.variable} (${currentGroup.unit})`}
                            stroke="#3b82f6"
                            strokeWidth={2}
                            dot={{ r: 3, fill: '#3b82f6' }}
                            activeDot={{ r: 5 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}

                    {/* Threshold summary */}
                    {(currentGroup.minThreshold !== null || currentGroup.maxThreshold !== null) && (
                      <div className="flex gap-4 mt-3 pt-3 border-t text-xs text-slate-500">
                        {currentGroup.minThreshold !== null && (
                          <span className="flex items-center gap-1">
                            <span className="h-2 w-4 border-2 border-amber-400 border-dashed rounded" />
                            Mínimo: {currentGroup.minThreshold} {currentGroup.unit}
                          </span>
                        )}
                        {currentGroup.maxThreshold !== null && (
                          <span className="flex items-center gap-1">
                            <span className="h-2 w-4 border-2 border-red-400 border-dashed rounded" />
                            Máximo: {currentGroup.maxThreshold} {currentGroup.unit}
                          </span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Recent measurements table */}
                {currentGroup.measurements.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Últimas mediciones</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-slate-50 text-xs font-medium text-slate-500 uppercase">
                            <th className="px-4 py-2 text-left">Fecha</th>
                            <th className="px-4 py-2 text-left">Valor</th>
                            <th className="px-4 py-2 text-left">Estado</th>
                            <th className="px-4 py-2 text-left">Registrado por</th>
                            <th className="px-4 py-2 text-left">Notas</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {[...currentGroup.measurements].reverse().slice(0, 15).map((m) => {
                            const alert =
                              (currentGroup.minThreshold !== null && m.value < currentGroup.minThreshold!) ||
                              (currentGroup.maxThreshold !== null && m.value > currentGroup.maxThreshold!);
                            return (
                              <tr key={m.id} className="hover:bg-slate-50">
                                <td className="px-4 py-2 text-slate-500 text-xs">
                                  {new Date(m.recordedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                                </td>
                                <td className="px-4 py-2">
                                  <span className={cn('font-medium', alert ? 'text-red-600' : 'text-slate-800')}>
                                    {m.value} {currentGroup.unit}
                                  </span>
                                </td>
                                <td className="px-4 py-2">
                                  {alert
                                    ? <span className="text-xs text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Alerta</span>
                                    : <span className="text-xs text-green-600 font-medium flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Normal</span>}
                                </td>
                                <td className="px-4 py-2 text-slate-500 text-xs">{m.recordedBy?.name}</td>
                                <td className="px-4 py-2 text-slate-400 text-xs">{m.notes ?? '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 rounded-lg border-2 border-dashed text-slate-300">
                <Activity className="h-12 w-12 mb-3" />
                <p className="text-sm">Selecciona una variable del panel izquierdo</p>
              </div>
            )}
          </div>
        </div>
      )}

      {!selectedEquipment && (
        <div className="flex flex-col items-center justify-center py-24 text-slate-300">
          <Activity className="h-14 w-14 mb-4" />
          <p className="text-base font-medium">Busca un equipo para ver sus mediciones</p>
          <p className="text-sm mt-1">Registra variables como temperatura, vibración, presión, etc.</p>
        </div>
      )}

      {/* ── Registrar medición ──────────────────────────────────────────────── */}
      <Dialog
        open={dialog === 'measure'}
        onClose={() => setDialog(null)}
        title="Registrar medición"
        description={selectedEquipment?.name}
      >
        <form onSubmit={measureForm.handleSubmit(onMeasure)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Variable *</label>
              <Input
                {...measureForm.register('variable', { required: true })}
                placeholder="ej. Temperatura"
                list="common-variables"
              />
              <datalist id="common-variables">
                {COMMON_VARIABLES.map((v) => (
                  <option key={v.label} value={v.label} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Unidad *</label>
              <Input
                {...measureForm.register('unit', { required: true })}
                placeholder="ej. °C"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Valor medido *</label>
              <Input
                {...measureForm.register('value', { required: true })}
                type="number"
                step="any"
                placeholder="85.4"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-500">Umbral mínimo</label>
              <Input
                {...measureForm.register('minThreshold')}
                type="number"
                step="any"
                placeholder="ej. 10"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-500">Umbral máximo</label>
              <Input
                {...measureForm.register('maxThreshold')}
                type="number"
                step="any"
                placeholder="ej. 80"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-500">Notas</label>
              <Input {...measureForm.register('notes')} placeholder="Observación opcional" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button type="submit" loading={saving}>Guardar medición</Button>
          </div>
        </form>
      </Dialog>

      {/* ── Umbrales ────────────────────────────────────────────────────────── */}
      <Dialog
        open={dialog === 'threshold'}
        onClose={() => setDialog(null)}
        title={`Umbrales — ${selectedVar}`}
        description={`Equipo: ${selectedEquipment?.name}`}
      >
        <form onSubmit={thresholdForm.handleSubmit(onThreshold)} className="space-y-4">
          <p className="text-sm text-slate-500">
            Define los límites aceptables. Se enviará una alerta por email cuando el valor registrado quede fuera de estos rangos.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mínimo</label>
              <Input
                {...thresholdForm.register('minThreshold')}
                type="number"
                step="any"
                placeholder="Sin límite inferior"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Máximo</label>
              <Input
                {...thresholdForm.register('maxThreshold')}
                type="number"
                step="any"
                placeholder="Sin límite superior"
              />
            </div>
          </div>
          <p className="text-xs text-slate-400">Dejar en blanco para desactivar ese límite.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button type="submit" loading={saving}>Guardar umbrales</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
