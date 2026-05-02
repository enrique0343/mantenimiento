import { Users as UsersIcon } from 'lucide-react';

export default function Users() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <UsersIcon className="h-5 w-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Usuarios</h1>
      </div>
      <div className="rounded-lg border bg-white p-12 text-center text-slate-400">
        <UsersIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Gestión de usuarios y roles</p>
        <p className="text-sm mt-1">Crear, editar y asignar roles — disponible desde Fase 1 (API lista)</p>
      </div>
    </div>
  );
}
