import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

// Implementación completa en Fase 2
router.get('/', authenticate, (_req, res) => {
  res.status(501).json({ message: 'Módulo de equipos: implementar en Fase 2' });
});

router.get('/:id', authenticate, (_req, res) => {
  res.status(501).json({ message: 'Módulo de equipos: implementar en Fase 2' });
});

router.post('/', authenticate, (_req, res) => {
  res.status(501).json({ message: 'Módulo de equipos: implementar en Fase 2' });
});

router.put('/:id', authenticate, (_req, res) => {
  res.status(501).json({ message: 'Módulo de equipos: implementar en Fase 2' });
});

router.get('/:id/qr', authenticate, (_req, res) => {
  res.status(501).json({ message: 'Módulo de equipos: implementar en Fase 2' });
});

router.get('/:id/history', authenticate, (_req, res) => {
  res.status(501).json({ message: 'Módulo de equipos: implementar en Fase 2' });
});

router.get('/:id/report', authenticate, (_req, res) => {
  res.status(501).json({ message: 'Módulo de equipos: implementar en Fase 2' });
});

export default router;
