import { Calendar } from 'lucide-react';

export default function Planner() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Calendar className="h-5 w-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Planificador</h1>
      </div>
      <div className="rounded-lg border bg-white p-12 text-center text-slate-400">
        <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Planificador de Mantenimiento</p>
        <p className="text-sm mt-1">Calendario con drag-and-drop y asignación de técnicos — Fase 5</p>
      </div>
    </div>
  );
}
