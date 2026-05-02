import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Wrench, ClipboardList, HeadphonesIcon,
  Calendar, Package, Users, Truck, Settings, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';

const nav = [
  { to: '/',             label: 'Dashboard',       icon: LayoutDashboard },
  { to: '/equipos',      label: 'Equipos',          icon: Wrench },
  { to: '/mantenimiento',label: 'Mantenimiento',    icon: ClipboardList },
  { to: '/helpdesk',     label: 'Helpdesk',         icon: HeadphonesIcon },
  { to: '/planificador', label: 'Planificador',     icon: Calendar },
  { to: '/inventario',   label: 'Inventario',       icon: Package },
  { to: '/usuarios',     label: 'Usuarios',         icon: Users,  roles: ['ADMIN', 'MAINTENANCE_CHIEF'] },
  { to: '/proveedores',  label: 'Proveedores',      icon: Truck },
  { to: '/configuracion',label: 'Configuración',    icon: Settings, roles: ['ADMIN'] },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: Props) {
  const { user } = useAuthStore();

  const visible = nav.filter(item =>
    !item.roles || item.roles.includes(user?.role ?? '')
  );

  return (
    <>
      {/* Overlay móvil */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-slate-900 text-white transition-transform duration-200 lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between px-5 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Wrench className="h-6 w-6 text-blue-400" />
            <span className="font-bold text-sm leading-tight">
              Gestión de<br />Mantenimiento
            </span>
          </div>
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navegación */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {visible.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => onClose()}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Usuario */}
        <div className="border-t border-slate-700 px-4 py-3">
          <p className="text-xs text-slate-400 truncate">{user?.name}</p>
          <p className="text-xs text-slate-500 truncate">{user?.email}</p>
        </div>
      </aside>
    </>
  );
}
