import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

// Implementación completa en Fase 3
const stub = (_req: any, res: any) =>
  res.status(501).json({ message: 'Módulo OTs: implementar en Fase 3' });

router.get('/', authenticate, stub);
router.post('/', authenticate, stub);
router.get('/:id', authenticate, stub);
router.patch('/:id/status', authenticate, stub);
router.post('/:id/images', authenticate, stub);
router.post('/:id/signatures', authenticate, stub);
router.post('/:id/spare-parts', authenticate, stub);
router.post('/:id/close', authenticate, stub);
router.get('/:id/pdf', authenticate, stub);

export default router;
