import { Wrench } from 'lucide-react';

export default function EquipmentList() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Wrench className="h-5 w-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Equipos</h1>
      </div>
      <div className="rounded-lg border bg-white p-12 text-center text-slate-400">
        <Wrench className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Módulo de Equipos</p>
        <p className="text-sm mt-1">Fichas técnicas, QR y bitácora — Fase 2</p>
      </div>
    </div>
  );
}
