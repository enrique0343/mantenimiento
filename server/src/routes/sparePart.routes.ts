import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import * as sp from '../controllers/sparePart.controller';

const router = Router();

router.get('/', authenticate, sp.list);
router.get('/alerts', authenticate, sp.alerts);
router.get('/:id', authenticate, sp.getById);
router.get('/:id/movements', authenticate, sp.movements);
router.post('/', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), sp.create);
router.put('/:id', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), sp.update);
router.patch('/:id/stock', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF', 'TECHNICIAN'), sp.adjustStock);
router.patch('/:id/min-stock', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), sp.setMinStock);
router.delete('/:id', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), sp.deactivate);

export default router;
