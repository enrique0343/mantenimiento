import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import Layout from '@/components/layout/Layout';
import ProtectedRoute from '@/components/layout/ProtectedRoute';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import EquipmentList from '@/pages/Equipment/EquipmentList';
import MaintenanceList from '@/pages/Maintenance/MaintenanceList';
import HelpdeskList from '@/pages/Helpdesk/HelpdeskList';
import HelpdeskPublicForm from '@/pages/Helpdesk/HelpdeskPublicForm';
import HelpdeskPublicTrack from '@/pages/Helpdesk/HelpdeskPublicTrack';
import Planner from '@/pages/Planner';
import Inventory from '@/pages/Inventory';
import Users from '@/pages/Users';
import Providers from '@/pages/Providers';
import Settings from '@/pages/Settings';

export default function App() {
  const { token, fetchMe } = useAuthStore();

  useEffect(() => {
    if (token) fetchMe();
  }, []);

  return (
    <Routes>
      {/* Rutas públicas */}
      <Route path="/login" element={<Login />} />
      <Route path="/helpdesk/nuevo" element={<HelpdeskPublicForm />} />
      <Route path="/helpdesk/ticket/:token" element={<HelpdeskPublicTrack />} />

      {/* Rutas protegidas */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/equipos" element={<EquipmentList />} />
          <Route path="/mantenimiento" element={<MaintenanceList />} />
          <Route path="/helpdesk" element={<HelpdeskList />} />
          <Route path="/planificador" element={<Planner />} />
          <Route path="/inventario" element={<Inventory />} />
          <Route path="/usuarios" element={<Users />} />
          <Route path="/proveedores" element={<Providers />} />
          <Route path="/configuracion" element={<Settings />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
