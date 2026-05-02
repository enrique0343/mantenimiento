import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList, CheckCircle2, Clock, AlertTriangle, TrendingUp,
  Star, Zap, Target, Award, ChevronRight,
} from 'lucide-react';
import {
  RadialBarChart, RadialBar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import api from '@/lib/api';
import { WO_STATUS_COLOR, WO_STATUS_LABEL, PRIORITY_COLOR, PRIORITY_LABEL, cn, formatDate } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface WO {
  id: string; code: string; status: string; priority: string; type: string;
  scheduledDate?: string; startedAt?: string; completedAt?: string;
  equipment?: { name: string; code: string; location?: { area: string } };
  locationDescription?: string;
}

interface KpiData {
  thisMonth: number;
  lastMonth: number;
  completedThisMonth: number;
  avgHours: number | null;
  onTime: number;
  overdue: number;
}

// ─── Motivational level ───────────────────────────────────────────────────────
function getLevel(completed: number): { level: number; title: string; next: number; color: string } {
  if (completed >= 100) return { level: 5, title: 'Experto',      next: 999, color: '#7c3aed' };
  if (completed >= 50)  return { level: 4, title: 'Avanzado',     next: 100, color: '#059669' };
  if (completed >= 25)  return { level: 3, title: 'Competente',   next: 50,  color: '#2563eb' };
  if (completed >= 10)  return { level: 2, title: 'Aprendiz',     next: 25,  color: '#d97706' };
  return                       { level: 1, title: 'Iniciando',    next: 10,  color: '#64748b' };
}

export default function TechnicianDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [pendingWOs, setPendingWOs] = useState<WO[]>([]);
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [monthlyData, setMonthlyData] = useState<{ mes: string; completadas: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    loadData();
  }, [user?.id]);

  async function loadData() {
    setLoading(true);
    try {
      // OTs pendientes del técnico (OPEN + IN_PROGRESS)
      const [pendRes, doneRes] = await Promise.all([
        api.get(`/work-orders?technicianId=${user!.id}&status=OPEN,IN_PROGRESS&limit=50`),
        api.get(`/work-orders?technicianId=${user!.id}&status=COMPLETED,VERIFIED,CLOSED&limit=200`),
      ]);

      const pending: WO[] = pendRes.data.data ?? [];
      const done: WO[]    = doneRes.data.data ?? [];

      setPendingWOs(pending);

      // KPIs del mes actual
      const now = new Date();
      const msStart = startOfMonth(now).toISOString();
      const msEnd   = endOfMonth(now).toISOString();

      const thisMonthDone = done.filter(w => w.completedAt && w.completedAt >= msStart && w.completedAt <= msEnd);
      const lastMs = subMonths(now, 1);
      const lsStart = startOfMonth(lastMs).toISOString();
      const lsEnd   = endOfMonth(lastMs).toISOString();
      const lastMonthDone = done.filter(w => w.completedAt && w.completedAt >= lsStart && w.completedAt <= lsEnd);

      const overdueCount = pending.filter(w => w.scheduledDate && new Date(w.scheduledDate) < now).length;
      const onTimeCount  = thisMonthDone.filter(w =>
        w.completedAt && w.scheduledDate && new Date(w.completedAt) <= new Date(w.scheduledDate)
      ).length;

      setKpis({
        thisMonth: pending.length,
        lastMonth: lastMonthDone.length,
        completedThisMonth: thisMonthDone.length,
        avgHours: null,
        onTime: onTimeCount,
        overdue: overdueCount,
      });

      // Últimos 5 meses de completadas
      const months = Array.from({ length: 5 }, (_, i) => {
        const m = subMonths(now, 4 - i);
        const s = startOfMonth(m).toISOString();
        const e = endOfMonth(m).toISOString();
        return {
          mes: format(m, 'MMM', { locale: es }),
          completadas: done.filter(w => w.completedAt && w.completedAt >= s && w.completedAt <= e).length,
        };
      });
      setMonthlyData(months);
    } catch {
      toast.error('Error al cargar tu dashboard');
    } finally {
      setLoading(false);
    }
  }

  const totalCompleted = kpis?.completedThisMonth ?? 0;
  // Use all-time completed for level (we approximate from done count)
  const lvl = getLevel(totalCompleted * 3); // multiply to simulate total since we only load 200

  const completionPct = kpis
    ? Math.min(100, Math.round((kpis.completedThisMonth / Math.max(kpis.completedThisMonth + kpis.thisMonth, 1)) * 100))
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Mi Panel</h1>
          <p className="text-sm text-slate-500">Hola, {user?.name} 👋</p>
        </div>
        <Button size="sm" onClick={loadData}>Actualizar</Button>
      </div>

      {/* Level card */}
      <Card className="border-0 text-white overflow-hidden" style={{ background: `linear-gradient(135deg, ${lvl.color}, ${lvl.color}cc)` }}>
        <CardContent className="p-4 flex items-center gap-4">
          <div className="flex items-center justify-center h-14 w-14 rounded-full bg-white/20 text-2xl font-bold shrink-0">
            {lvl.level === 5 ? <Award className="h-7 w-7" /> : lvl.level}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium opacity-80">Nivel {lvl.level}</p>
            <p className="text-xl font-bold">{lvl.title}</p>
            <div className="mt-1.5 bg-white/20 rounded-full h-1.5 w-full">
              <div
                className="bg-white rounded-full h-1.5 transition-all"
                style={{ width: `${Math.min(100, (kpis?.completedThisMonth ?? 0) / lvl.next * 100)}%` }}
              />
            </div>
            <p className="text-xs opacity-70 mt-0.5">
              {kpis?.completedThisMonth ?? 0} / {lvl.next} OTs para el siguiente nivel
            </p>
          </div>
          <Zap className="h-8 w-8 opacity-40 shrink-0" />
        </CardContent>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: ClipboardList, label: 'Pendientes',     value: kpis?.thisMonth ?? 0,          color: 'text-blue-600',  bg: 'bg-blue-50' },
          { icon: CheckCircle2,  label: 'Este mes',       value: kpis?.completedThisMonth ?? 0, color: 'text-green-600', bg: 'bg-green-50' },
          { icon: AlertTriangle, label: 'Atrasadas',      value: kpis?.overdue ?? 0,            color: 'text-red-600',   bg: 'bg-red-50' },
          { icon: Target,        label: 'A tiempo',       value: kpis?.onTime ?? 0,             color: 'text-purple-600',bg: 'bg-purple-50' },
        ].map(({ icon: Icon, label, value, color, bg }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center shrink-0', bg)}>
                <Icon className={cn('h-5 w-5', color)} />
              </div>
              <div>
                <p className={cn('text-2xl font-bold', color)}>{value}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Completion gauge */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Avance del mes</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-center">
            <div className="relative" style={{ width: 160, height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart innerRadius={50} outerRadius={70} data={[{ value: completionPct, fill: '#2563eb' }]} startAngle={90} endAngle={-270}>
                  <RadialBar dataKey="value" cornerRadius={8} background={{ fill: '#e2e8f0' }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-3xl font-bold text-slate-800">{completionPct}%</p>
                <p className="text-xs text-slate-400">completado</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Monthly trend */}
        <Card>
          <CardHeader><CardTitle className="text-sm">OTs completadas por mes</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={monthlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="completadas" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Pending WOs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-blue-500" />
              Mis OTs pendientes ({pendingWOs.length})
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {pendingWOs.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="h-10 w-10 mx-auto text-green-400 mb-2" />
              <p className="text-slate-500 text-sm font-medium">¡Al día! No tienes OTs pendientes.</p>
              <p className="text-slate-400 text-xs mt-0.5">Buen trabajo 🎉</p>
            </div>
          ) : (
            <div className="divide-y">
              {pendingWOs.map(wo => {
                const isOverdue = wo.scheduledDate && new Date(wo.scheduledDate) < new Date() && wo.status === 'OPEN';
                return (
                  <button
                    key={wo.id}
                    onClick={() => navigate(`/mantenimiento/${wo.id}`)}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-medium text-slate-800 truncate text-sm">
                          {wo.equipment?.name ?? wo.locationDescription ?? 'Trabajo general'}
                        </p>
                        {isOverdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="font-mono">{wo.code}</span>
                        {wo.equipment?.location?.area && <span>· {wo.equipment.location.area}</span>}
                        {wo.scheduledDate && <span>· {formatDate(wo.scheduledDate)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', PRIORITY_COLOR[wo.priority])}>
                        {PRIORITY_LABEL[wo.priority]}
                      </span>
                      <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', WO_STATUS_COLOR[wo.status])}>
                        {WO_STATUS_LABEL[wo.status]}
                      </span>
                      <ChevronRight className="h-4 w-4 text-slate-300" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {pendingWOs.some(w => w.status === 'OPEN' && w.scheduledDate && new Date(w.scheduledDate) < new Date()) && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>Tienes OTs con fecha vencida. Actualiza su estado o repórtalo a tu jefe de mantenimiento.</p>
        </div>
      )}
    </div>
  );
}
