import { Truck } from 'lucide-react';

export default function Providers() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Truck className="h-5 w-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Proveedores</h1>
      </div>
      <div className="rounded-lg border bg-white p-12 text-center text-slate-400">
        <Truck className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Gestión de proveedores externos</p>
        <p className="text-sm mt-1">Ficha, contratos, SLA y evaluación de desempeño — disponible (API lista)</p>
      </div>
    </div>
  );
}
