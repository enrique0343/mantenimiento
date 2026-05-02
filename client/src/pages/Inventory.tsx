import { Package } from 'lucide-react';

export default function Inventory() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Package className="h-5 w-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Inventario de Repuestos</h1>
      </div>
      <div className="rounded-lg border bg-white p-12 text-center text-slate-400">
        <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Gestión de repuestos e insumos</p>
        <p className="text-sm mt-1">Stock por sucursal, alertas de mínimo, movimientos — Fase 6</p>
      </div>
    </div>
  );
}
