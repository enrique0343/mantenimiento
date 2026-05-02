import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { signToken } from '../utils/jwt';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    res.status(401).json({ message: 'Credenciales inválidas' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    res.status(401).json({ message: 'Credenciales inválidas' });
    return;
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    branchId: user.branchId,
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      branchId: user.branchId,
    },
  });
}

export async function me(req: AuthRequest, res: Response): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      branchId: true,
      branch: { select: { id: true, name: true } },
    },
  });

  if (!user) {
    res.status(404).json({ message: 'Usuario no encontrado' });
    return;
  }

  res.json(user);
}
