import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  list, getById, getByCode, create, update, getQR, history, report,
} from '../controllers/equipment.controller';

const router = Router();

router.get('/', authenticate, list);
router.get('/code/:code', authenticate, getByCode);
router.get('/:id', authenticate, getById);
router.get('/:id/qr', authenticate, getQR);
router.get('/:id/history', authenticate, history);
router.get('/:id/report', authenticate, report);

router.post('/', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), create);
router.put('/:id', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), update);

export default router;
