import { Router } from 'express';
import authRoutes from './auth.routes';
import branchRoutes from './branch.routes';
import settingsRoutes from './settings.routes';
import equipmentRoutes from './equipment.routes';
import workOrderRoutes from './workOrder.routes';
import maintenancePlanRoutes from './maintenancePlan.routes';
import measurementRoutes from './measurement.routes';
import helpdeskRoutes from './helpdesk.routes';
import sparePartRoutes from './sparePart.routes';
import kpiRoutes from './kpi.routes';
import userRoutes from './user.routes';
import providerRoutes from './provider.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/branches', branchRoutes);
router.use('/settings', settingsRoutes);
router.use('/equipments', equipmentRoutes);
router.use('/work-orders', workOrderRoutes);
router.use('/maintenance-plans', maintenancePlanRoutes);
router.use('/measurements', measurementRoutes);
router.use('/helpdesk', helpdeskRoutes);
router.use('/spare-parts', sparePartRoutes);
router.use('/kpis', kpiRoutes);
router.use('/users', userRoutes);
router.use('/providers', providerRoutes);

export default router;
