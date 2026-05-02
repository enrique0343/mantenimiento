import { Menu, LogOut, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { ROLE_LABEL } from '@/lib/utils';
import QrScannerButton from '@/components/qr/QrScannerButton';

interface Props {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: Props) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden sm:block text-right mr-2">
          <p className="text-sm font-medium text-slate-800">{user?.name}</p>
          <p className="text-xs text-slate-500">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</p>
        </div>

        <QrScannerButton />

        <Button variant="ghost" size="icon" title="Notificaciones">
          <Bell className="h-5 w-5 text-slate-500" />
        </Button>

        <Button variant="ghost" size="icon" onClick={handleLogout} title="Cerrar sesión">
          <LogOut className="h-5 w-5 text-slate-500" />
        </Button>
      </div>
    </header>
  );
}
