import { ClipboardList } from 'lucide-react';

export default function MaintenanceList() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Mantenimiento</h1>
      </div>
      <div className="rounded-lg border bg-white p-12 text-center text-slate-400">
        <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Órdenes de Trabajo</p>
        <p className="text-sm mt-1">Preventivo · Correctivo · Predictivo — Fases 3 y 5</p>
      </div>
    </div>
  );
}
