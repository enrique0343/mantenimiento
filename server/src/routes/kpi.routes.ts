import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as kpi from '../controllers/kpi.controller';

const router = Router();

router.get('/dashboard', authenticate, kpi.dashboard);
router.get('/equipment/:id', authenticate, kpi.equipmentKpis);

export default router;
