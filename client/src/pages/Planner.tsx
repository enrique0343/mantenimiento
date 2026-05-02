import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, dateFnsLocalizer, Views, type View } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { Calendar as CalendarIcon, AlertTriangle, ChevronLeft, ChevronRight, List } from 'lucide-react';
import api from '@/lib/api';
import type { WorkOrder, Branch, MaintenancePlan } from '@/types';
import { FREQUENCY_LABEL, formatDate, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';

const DnDCalendar = withDragAndDrop(Calendar);

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: es }),
  getDay,
  locales: { es },
});

const TYPE_COLOR: Record<string, string> = {
  PREVENTIVE: '#16a34a',
  CORRECTIVE: '#dc2626',
  PREDICTIVE: '#7c3aed',
};

const TYPE_BG: Record<string, string> = {
  PREVENTIVE: '#dcfce7',
  CORRECTIVE: '#fee2e2',
  PREDICTIVE: '#ede9fe',
};

interface CalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: WorkOrder;
}

const MESSAGES = {
  today: 'Hoy',
  previous: 'Anterior',
  next: 'Siguiente',
  month: 'Mes',
  week: 'Semana',
  day: 'Día',
  agenda: 'Agenda',
  date: 'Fecha',
  time: 'Hora',
  event: 'OT',
  noEventsInRange: 'No hay OTs programadas en este rango',
};

export default function Planner() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>(Views.MONTH);
  const [date, setDate] = useState(new Date());
  const [tab, setTab] = useState<'calendar' | 'upcoming'>('calendar');
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [upcoming, setUpcoming] = useState<MaintenancePlan[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [filterBranch, setFilterBranch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/branches').then(({ data }) => setBranches(data)).catch(() => {});
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const from = new Date(date.getFullYear(), date.getMonth() - 1, 1).toISOString();
      const to = new Date(date.getFullYear(), date.getMonth() + 2, 0).toISOString();
      params.set('from', from);
      params.set('to', to);
      params.set('limit', '200');
      if (filterBranch) params.set('branchId', filterBranch);

      const { data } = await api.get(`/work-orders?${params}`);
      const wos: WorkOrder[] = data.data ?? [];

      setEvents(
        wos
          .filter((wo) => wo.scheduledDate)
          .map((wo) => {
            const start = new Date(wo.scheduledDate!);
            const hours = (wo as any).estimatedHours ?? 1;
            const end = new Date(start.getTime() + Number(hours) * 3600000);
            return {
              id: wo.id,
              title: (wo as any).equipment?.name ?? wo.code,
              start,
              end,
              resource: wo,
            };
          })
      );
    } catch {
      toast.error('Error al cargar el calendario');
    } finally {
      setLoading(false);
    }
  }, [date, filterBranch]);

  const fetchUpcoming = useCallback(async () => {
    try {
      const params = new URLSearchParams({ days: '30' });
      if (filterBranch) params.set('branchId', filterBranch);
      const { data } = await api.get(`/maintenance-plans/upcoming?${params}`);
      setUpcoming(data);
    } catch { /* non-critical */ }
  }, [filterBranch]);

  useEffect(() => {
    fetchEvents();
    fetchUpcoming();
  }, [fetchEvents, fetchUpcoming]);

  function eventStyleGetter(event: CalEvent) {
    const type = event.resource.type;
    return {
      style: {
        backgroundColor: TYPE_BG[type] ?? '#f1f5f9',
        color: TYPE_COLOR[type] ?? '#334155',
        border: `1px solid ${TYPE_COLOR[type] ?? '#94a3b8'}`,
        borderRadius: '4px',
        fontSize: '11px',
        padding: '1px 4px',
      },
    };
  }

  function handleSelectSlot({ start }: { start: Date }) {
    const dateStr = format(start, 'yyyy-MM-dd');
    navigate('/mantenimiento/nuevo', { state: { scheduledDate: dateStr } });
  }

  async function handleEventDrop({ event, start }: { event: CalEvent; start: Date | string }) {
    const newStart = new Date(start);
    const oldStart = event.start;
    // Optimistic update
    setEvents(prev =>
      prev.map(e =>
        e.id === event.id
          ? { ...e, start: newStart, end: new Date(newStart.getTime() + (e.end.getTime() - e.start.getTime())) }
          : e
      )
    );
    try {
      await api.patch(`/work-orders/${event.id}/reschedule`, {
        scheduledDate: newStart.toISOString(),
      });
      toast.success(`OT reprogramada a ${format(newStart, 'dd/MM/yyyy', { locale: es })}`);
    } catch (err: any) {
      // Revert on error
      setEvents(prev =>
        prev.map(e => e.id === event.id ? { ...e, start: oldStart, end: event.end } : e)
      );
      toast.error(err.response?.data?.message ?? 'No se pudo reprogramar la OT');
    }
  }

  async function handleEventResize({ event, start, end }: { event: CalEvent; start: Date | string; end: Date | string }) {
    const newStart = new Date(start);
    const newEnd = new Date(end);
    setEvents(prev => prev.map(e => e.id === event.id ? { ...e, start: newStart, end: newEnd } : e));
    try {
      await api.patch(`/work-orders/${event.id}/reschedule`, { scheduledDate: newStart.toISOString() });
    } catch {
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, start: event.start, end: event.end } : e));
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-800">Planificador</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={filterBranch}
            onChange={(e) => setFilterBranch(e.target.value)}
            placeholder="Todas las sucursales"
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            className="w-48"
          />
          <Button size="sm" onClick={() => navigate('/mantenimiento/nuevo')}>
            + Nueva OT
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { value: 'calendar', label: 'Calendario', icon: CalendarIcon },
          { value: 'upcoming', label: 'Próximos vencimientos', icon: AlertTriangle },
        ].map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setTab(value as any)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === value ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {value === 'upcoming' && upcoming.length > 0 && (
              <span className="rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 text-xs font-bold">
                {upcoming.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Calendar tab */}
      {tab === 'calendar' && (
        <div className="space-y-3">
          {/* Legend + toolbar */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3 text-xs text-slate-500">
              {Object.entries({ PREVENTIVE: 'Preventivo', CORRECTIVE: 'Correctivo', PREDICTIVE: 'Predictivo' }).map(([type, label]) => (
                <span key={type} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: TYPE_COLOR[type] }} />
                  {label}
                </span>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => setDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDate(new Date())}>Hoy</Button>
              <Button variant="outline" size="icon" onClick={() => setDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="mx-2 text-sm font-medium text-slate-700 min-w-[140px] text-center">
                {format(date, 'MMMM yyyy', { locale: es })}
              </span>
              <div className="flex gap-1 ml-2">
                {[
                  { v: Views.MONTH, label: 'Mes' },
                  { v: Views.WEEK, label: 'Semana' },
                  { v: Views.AGENDA, label: <List className="h-4 w-4" /> },
                ].map(({ v, label }) => (
                  <Button
                    key={v as string}
                    variant={view === v ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setView(v)}
                  >
                    {label as any}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white border rounded-lg overflow-hidden relative" style={{ height: 640 }}>
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
            <DnDCalendar
              localizer={localizer}
              events={events}
              view={view}
              date={date}
              onView={setView}
              onNavigate={setDate}
              onSelectEvent={(event) => navigate(`/mantenimiento/${(event as CalEvent).id}`)}
              onSelectSlot={handleSelectSlot}
              onEventDrop={handleEventDrop as any}
              onEventResize={handleEventResize as any}
              resizable
              selectable
              draggableAccessor={() => true}
              eventPropGetter={eventStyleGetter as any}
              messages={MESSAGES}
              toolbar={false}
              popup
              style={{ height: '100%' }}
            />
          </div>
          <p className="text-xs text-slate-400 text-right">
            Clic para ver detalle · Arrastrar para reprogramar · Clic en día vacío para crear OT
          </p>
        </div>
      )}

      {/* Upcoming tab */}
      {tab === 'upcoming' && (
        <div className="space-y-3">
          {upcoming.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-slate-400">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>No hay planes venciendo en los próximos 30 días</p>
              </CardContent>
            </Card>
          ) : (
            upcoming.map((plan) => {
              const msLeft = new Date(plan.nextDueDate).getTime() - Date.now();
              const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
              const overdue = msLeft < 0;
              return (
                <Card
                  key={plan.id}
                  className={cn('border', overdue ? 'border-red-200 bg-red-50' : daysLeft <= 7 ? 'border-amber-200 bg-amber-50' : '')}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-slate-800 truncate">{(plan as any).equipment?.name ?? '—'}</p>
                          <span className="rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-xs font-medium shrink-0">
                            {FREQUENCY_LABEL[plan.frequency]}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500">{(plan as any).name}</p>
                        <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
                          <span>📍 {(plan as any).equipment?.location?.branch?.name}</span>
                          {(plan as any).assignedUser && <span>👤 {(plan as any).assignedUser.name}</span>}
                          {(plan as any).estimatedHours && <span>⏱ {(plan as any).estimatedHours}h</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {overdue ? (
                          <p className="text-sm font-bold text-red-600 flex items-center gap-1">
                            <AlertTriangle className="h-4 w-4" /> Vencido {Math.abs(daysLeft)}d
                          </p>
                        ) : (
                          <p className={cn('text-sm font-semibold', daysLeft <= 3 ? 'text-red-600' : daysLeft <= 7 ? 'text-amber-600' : 'text-slate-600')}>
                            En {daysLeft} día{daysLeft !== 1 ? 's' : ''}
                          </p>
                        )}
                        <p className="text-xs text-slate-400 mt-0.5">{formatDate(plan.nextDueDate)}</p>
                        <Button
                          size="sm"
                          className="mt-2"
                          onClick={() => navigate('/mantenimiento/nuevo', {
                            state: { type: 'PREVENTIVE', equipmentId: (plan as any).equipmentId },
                          })}
                        >
                          Crear OT preventiva
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
