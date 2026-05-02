import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

const stub = (_req: any, res: any) =>
  res.status(501).json({ message: 'Planes de mantenimiento: implementar en Fase 5' });

router.get('/', authenticate, stub);
router.post('/', authenticate, stub);
router.put('/:id', authenticate, stub);
router.get('/upcoming', authenticate, stub);

export default router;
