import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import Layout from '@/components/layout/Layout';
import ProtectedRoute from '@/components/layout/ProtectedRoute';

// Auth
import Login from '@/pages/Login';

// Equipment
import EquipmentList from '@/pages/Equipment/EquipmentList';
import EquipmentForm from '@/pages/Equipment/EquipmentForm';
import EquipmentDetail from '@/pages/Equipment/EquipmentDetail';
import EquipmentAccess from '@/pages/Equipment/EquipmentAccess';

// Maintenance
import WorkOrderForm from '@/pages/Maintenance/WorkOrderForm';
import WorkOrderDetail from '@/pages/Maintenance/WorkOrderDetail';
import MaintenancePlanList from '@/pages/MaintenancePlans/MaintenancePlanList';
import MaintenancePlanForm from '@/pages/MaintenancePlans/MaintenancePlanForm';

// Other modules
import Dashboard from '@/pages/Dashboard';
import MaintenanceList from '@/pages/Maintenance/MaintenanceList';
import HelpdeskList from '@/pages/Helpdesk/HelpdeskList';
import HelpdeskDetail from '@/pages/Helpdesk/HelpdeskDetail';
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

      {/* Acceso QR — requiere login, pero fuera del layout principal */}
      <Route element={<ProtectedRoute />}>
        <Route path="/equipo/:code/acceso" element={<EquipmentAccess />} />
      </Route>

      {/* Rutas protegidas con layout */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />

          {/* Equipos */}
          <Route path="/equipos" element={<EquipmentList />} />
          <Route path="/equipos/nuevo" element={<EquipmentForm />} />
          <Route path="/equipos/:id" element={<EquipmentDetail />} />
          <Route path="/equipos/:id/editar" element={<EquipmentForm />} />

          {/* Mantenimiento */}
          <Route path="/mantenimiento" element={<MaintenanceList />} />
          <Route path="/mantenimiento/nuevo" element={<WorkOrderForm />} />
          <Route path="/mantenimiento/:id" element={<WorkOrderDetail />} />

          {/* Planes de mantenimiento */}
          <Route path="/planes" element={<MaintenancePlanList />} />
          <Route path="/planes/nuevo" element={<MaintenancePlanForm />} />
          <Route path="/planes/:id/editar" element={<MaintenancePlanForm />} />

          {/* Otros módulos */}
          <Route path="/helpdesk" element={<HelpdeskList />} />
          <Route path="/helpdesk/:id" element={<HelpdeskDetail />} />
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
