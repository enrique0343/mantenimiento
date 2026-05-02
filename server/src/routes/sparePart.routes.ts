import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

const stub = (_req: any, res: any) =>
  res.status(501).json({ message: 'Inventario: implementar en Fase 6' });

router.get('/', authenticate, stub);
router.post('/', authenticate, stub);
router.get('/alerts', authenticate, stub);
router.patch('/:id/stock', authenticate, stub);
router.get('/:id/movements', authenticate, stub);

export default router;
