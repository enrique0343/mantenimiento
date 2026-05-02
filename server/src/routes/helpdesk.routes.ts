import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

// Implementación completa en Fase 4
const stub = (_req: any, res: any) =>
  res.status(501).json({ message: 'Helpdesk: implementar en Fase 4' });

// Ruta pública (sin auth) — seguimiento por token
router.get('/track/:token', stub);

// Ruta pública (sin auth) — crear ticket
router.post('/tickets', stub);

// Rutas internas (con auth)
router.get('/tickets', authenticate, stub);
router.get('/tickets/:id', authenticate, stub);
router.patch('/tickets/:id/status', authenticate, stub);
router.post('/tickets/:id/assign', authenticate, stub);
router.post('/tickets/:id/comments', authenticate, stub);
router.post('/tickets/:id/convert', authenticate, stub);

export default router;
