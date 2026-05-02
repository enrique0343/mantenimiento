import { useState, useEffect } from 'react';
import {
  LayoutDashboard, Wrench, ClipboardList, HeadphonesIcon,
  AlertTriangle, TrendingUp, CheckCircle2, Package,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import api from '@/lib/api';
import type { Branch } from '@/types';
import { WO_STATUS_LABEL, cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';

interface KpiData {
  equipmentTotal: number;
  equipmentActive: number;
  availabilityPct: number;
  openWOs: number;
  inProgressWOs: number;
  thisMonthTotal: number;
  thisMonthCompleted: number;
  preventiveCompliance: number | null;
  avgMTTR: number | null;
  openTickets: number;
  resolvedThisMonth: number;
  stockAlerts: number;
  woByStatus: { status: string; count: number }[];
  woByTypePerMonth: { month: string; PREVENTIVE: number; CORRECTIVE: number; PREDICTIVE: number }[];
  topEquipment: { name: string; code: string; count: number }[];
}

const STATUS_PIE_COLORS: Record<string, string> = {
  OPEN: '#3b82f6',
  IN_PROGRESS: '#f59e0b',
  COMPLETED: '#10b981',
  VERIFIED: '#8b5cf6',
  CLOSED: '#94a3b8',
};

const TYPE_COLORS = {
  PREVENTIVE: '#16a34a',
  CORRECTIVE: '#dc2626',
  PREDICTIVE: '#7c3aed',
};

function StatCard({
  label, value, sub, icon: Icon, color, alert,
}: {
  label: string; value: string | number; sub: string;
  icon: React.ElementType; color: string; alert?: boolean;
}) {
  return (
    <Card className={cn(alert && value !== 0 && 'border-red-200 bg-red-50')}>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className={cn('text-3xl font-bold mt-1', color)}>{value}</p>
            <p className="text-xs text-slate-400 mt-1">{sub}</p>
          </div>
          <div className={cn('rounded-full p-2', color.replace('text-', 'bg-').replace('600', '100').replace('500', '100'))}>
            <Icon className={cn('h-5 w-5', color)} />
          </div>
        </div>
      </CardContent>
    </Card>
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

export default function Dashboard() {
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [filterBranch, setFilterBranch] = useState('');

  useEffect(() => {
    api.get('/branches').then(({ data }) => setBranches(data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = filterBranch ? `?branchId=${filterBranch}` : '';
    api.get(`/kpis/dashboard${params}`)
      .then(({ data }) => setKpis(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterBranch]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
        </div>
        <Select
          value={filterBranch}
          onChange={(e) => setFilterBranch(e.target.value)}
          placeholder="Todas las sucursales"
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          className="w-52"
        />
      </div>

      {loading || !kpis ? (
        <div className="flex items-center justify-center py-20">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Disponibilidad de equipos"
              value={`${kpis.availabilityPct}%`}
              sub={`${kpis.equipmentActive} / ${kpis.equipmentTotal} operativos`}
              icon={Wrench}
              color={kpis.availabilityPct >= 90 ? 'text-green-600' : kpis.availabilityPct >= 70 ? 'text-amber-600' : 'text-red-600'}
            />
            <StatCard
              label="OTs abiertas"
              value={kpis.openWOs + kpis.inProgressWOs}
              sub={`${kpis.openWOs} abiertas · ${kpis.inProgressWOs} en progreso`}
              icon={ClipboardList}
              color="text-blue-600"
            />
            <StatCard
              label="Cumplimiento preventivo"
              value={kpis.preventiveCompliance !== null ? `${kpis.preventiveCompliance}%` : '—'}
              sub="Preventivas completadas este mes"
              icon={CheckCircle2}
              color={
                kpis.preventiveCompliance === null ? 'text-slate-400'
                : kpis.preventiveCompliance >= 80 ? 'text-green-600'
                : kpis.preventiveCompliance >= 50 ? 'text-amber-600'
                : 'text-red-600'
              }
            />
            <StatCard
              label="Tickets sin atender"
              value={kpis.openTickets}
              sub={`${kpis.resolvedThisMonth} resueltos este mes`}
              icon={HeadphonesIcon}
              color={kpis.openTickets > 10 ? 'text-red-600' : kpis.openTickets > 3 ? 'text-amber-600' : 'text-slate-600'}
            />
          </div>

          {/* Secondary metrics */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <TrendingUp className="h-8 w-8 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-sm text-slate-500">MTTR promedio</p>
                    <p className="text-2xl font-bold text-slate-800">
                      {kpis.avgMTTR !== null ? `${kpis.avgMTTR}h` : '—'}
                    </p>
                    <p className="text-xs text-slate-400">Tiempo medio de reparación</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <ClipboardList className="h-8 w-8 text-green-500 shrink-0" />
                  <div>
                    <p className="text-sm text-slate-500">OTs este mes</p>
                    <p className="text-2xl font-bold text-slate-800">{kpis.thisMonthTotal}</p>
                    <p className="text-xs text-slate-400">{kpis.thisMonthCompleted} completadas</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className={cn(kpis.stockAlerts > 0 && 'border-red-200 bg-red-50')}>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <Package className={cn('h-8 w-8 shrink-0', kpis.stockAlerts > 0 ? 'text-red-500' : 'text-slate-400')} />
                  <div>
                    <p className="text-sm text-slate-500">Alertas de stock</p>
                    <p className={cn('text-2xl font-bold', kpis.stockAlerts > 0 ? 'text-red-600' : 'text-slate-800')}>
                      {kpis.stockAlerts}
                    </p>
                    <p className="text-xs text-slate-400">Repuestos bajo mínimo</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts row 1 */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* OTs by type per month — bar chart */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">OTs por tipo — últimos 6 meses</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={kpis.woByTypePerMonth} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="PREVENTIVE" name="Preventivo" fill={TYPE_COLORS.PREVENTIVE} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="CORRECTIVE" name="Correctivo" fill={TYPE_COLORS.CORRECTIVE} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="PREDICTIVE" name="Predictivo" fill={TYPE_COLORS.PREDICTIVE} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* WOs by status — pie chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">OTs por estado</CardTitle>
              </CardHeader>
              <CardContent>
                {kpis.woByStatus.length === 0 ? (
                  <div className="flex items-center justify-center h-[200px] text-slate-300 text-sm">Sin datos</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie
                          data={kpis.woByStatus}
                          dataKey="count"
                          nameKey="status"
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          label={({ name, percent }) => `${Math.round(percent * 100)}%`}
                          labelLine={false}
                        >
                          {kpis.woByStatus.map((entry) => (
                            <Cell key={entry.status} fill={STATUS_PIE_COLORS[entry.status] ?? '#94a3b8'} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v, n) => [v, WO_STATUS_LABEL[n as string] ?? n]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1.5 mt-2">
                      {kpis.woByStatus.map((s) => (
                        <div key={s.status} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_PIE_COLORS[s.status] ?? '#94a3b8' }} />
                            <span className="text-slate-600">{WO_STATUS_LABEL[s.status] ?? s.status}</span>
                          </div>
                          <span className="font-bold text-slate-700">{s.count}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Charts row 2 */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Top 5 equipment */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Top equipos con más OTs
                </CardTitle>
              </CardHeader>
              <CardContent>
                {kpis.topEquipment.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">Sin datos</p>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={kpis.topEquipment}
                      layout="vertical"
                      margin={{ top: 0, right: 30, left: 10, bottom: 0 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="count" name="OTs" fill="#3b82f6" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Helpdesk + MTTR trend (simple line) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tendencia OTs — últimos 6 meses</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart
                    data={kpis.woByTypePerMonth.map(m => ({
                      month: m.month,
                      total: m.PREVENTIVE + m.CORRECTIVE + m.PREDICTIVE,
                      correctivo: m.CORRECTIVE,
                    }))}
                    margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
                  >
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="total" name="Total OTs" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="correctivo" name="Correctivas" stroke="#dc2626" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
