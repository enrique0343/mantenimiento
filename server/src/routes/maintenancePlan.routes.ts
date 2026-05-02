import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import * as mp from '../controllers/maintenancePlan.controller';

const router = Router();

router.get('/', authenticate, mp.list);
router.get('/upcoming', authenticate, mp.upcoming);
router.get('/:id', authenticate, mp.getById);
router.post('/', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), mp.create);
router.put('/:id', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), mp.update);
router.delete('/:id', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), mp.deactivate);

export default router;
