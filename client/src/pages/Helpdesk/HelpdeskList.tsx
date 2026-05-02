import { HeadphonesIcon } from 'lucide-react';

export default function HelpdeskList() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <HeadphonesIcon className="h-5 w-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Helpdesk — Mesa de Ayuda</h1>
      </div>
      <div className="rounded-lg border bg-white p-12 text-center text-slate-400">
        <HeadphonesIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Gestión de tickets de soporte</p>
        <p className="text-sm mt-1">Formulario público, seguimiento por email, conversión a OT — Fase 4</p>
      </div>
    </div>
  );
}
