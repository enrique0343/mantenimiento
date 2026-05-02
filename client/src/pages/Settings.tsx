import { Settings as SettingsIcon } from 'lucide-react';

export default function Settings() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SettingsIcon className="h-5 w-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Configuración</h1>
      </div>
      <div className="rounded-lg border bg-white p-12 text-center text-slate-400">
        <SettingsIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Configuración general</p>
        <p className="text-sm mt-1">Empresa, logo, sucursales, SMTP — disponible (API lista)</p>
      </div>
    </div>
  );
}
