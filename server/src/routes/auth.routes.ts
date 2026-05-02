import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
import { login, me } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Demasiados intentos de login, intente en 15 minutos' },
});

router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Email inválido'),
    body('password').notEmpty().withMessage('Contraseña requerida'),
  ],
  login
);

router.get('/me', authenticate, me);

export default router;
