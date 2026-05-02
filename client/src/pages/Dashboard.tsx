import { LayoutDashboard } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const kpis = [
  { label: 'Equipos operativos', value: '—', sub: 'Disponibilidad', color: 'text-green-600' },
  { label: 'OTs abiertas', value: '—', sub: 'Órdenes de trabajo', color: 'text-blue-600' },
  { label: 'Cumplimiento preventivo', value: '—', sub: 'Este mes', color: 'text-purple-600' },
  { label: 'Tickets helpdesk', value: '—', sub: 'Sin atender', color: 'text-orange-600' },
];

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <LayoutDashboard className="h-5 w-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">{k.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-slate-400 mt-1">{k.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-lg border bg-white p-8 text-center text-slate-400">
        <p className="text-sm">Gráficos de KPIs — se implementan en Fase 6</p>
      </div>
    </div>
  );
}
