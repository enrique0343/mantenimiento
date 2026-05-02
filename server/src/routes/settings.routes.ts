import { Router } from 'express';
import nodemailer from 'nodemailer';
import { authenticate, requireRoles } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { uploadFile, deleteFile } from '../services/storage.service';
import prisma from '../lib/prisma';

const router = Router();

const SAFE_SELECT = {
  id: true, name: true, nit: true, address: true, phone: true, email: true,
  logoUrl: true, smtpHost: true, smtpPort: true, smtpUser: true,
  smtpFromName: true, smtpSecure: true,
  // smtpPass intentionally excluded from default select
};

router.get('/', authenticate, async (_req, res) => {
  const company = await prisma.company.findFirst({ select: SAFE_SELECT });
  res.json(company ?? {});
});

router.put('/', authenticate, requireRoles('ADMIN'), async (req, res) => {
  const { name, nit, address, phone, email } = req.body;
  const existing = await prisma.company.findFirst();
  const company = existing
    ? await prisma.company.update({
        where: { id: existing.id },
        data: { name, nit, address, phone, email },
        select: SAFE_SELECT,
      })
    : await prisma.company.create({
        data: { name, nit, address, phone, email },
        select: SAFE_SELECT,
      });
  res.json(company);
});

router.put('/smtp', authenticate, requireRoles('ADMIN'), async (req, res) => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, smtpFromName, smtpSecure } = req.body;
  const existing = await prisma.company.findFirst();

  const data: Record<string, any> = {
    smtpHost, smtpPort: smtpPort ? Number(smtpPort) : null,
    smtpUser, smtpFromName, smtpSecure: !!smtpSecure,
  };
  // Only update password if provided
  if (smtpPass) data.smtpPass = smtpPass;

  const company = existing
    ? await prisma.company.update({ where: { id: existing.id }, data, select: SAFE_SELECT })
    : await prisma.company.create({ data, select: SAFE_SELECT });
  res.json(company);
});

router.post('/smtp/test', authenticate, requireRoles('ADMIN'), async (req, res) => {
  const { to } = req.body;
  if (!to) { res.status(400).json({ message: 'Falta el destinatario de prueba' }); return; }

  const company = await prisma.company.findFirst();
  if (!company?.smtpHost || !company?.smtpUser || !company?.smtpPass) {
    res.status(400).json({ message: 'Configure los datos SMTP antes de enviar la prueba' });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: company.smtpHost,
      port: company.smtpPort ?? 587,
      secure: company.smtpSecure,
      auth: { user: company.smtpUser, pass: company.smtpPass },
    });
    await transporter.sendMail({
      from: `"${company.smtpFromName || company.name}" <${company.smtpUser}>`,
      to,
      subject: 'Prueba de configuración SMTP',
      text: `Configuración SMTP de ${company.name} funcionando correctamente.`,
    });
    res.json({ message: 'Email de prueba enviado correctamente' });
  } catch (err: any) {
    res.status(500).json({ message: `Error al enviar: ${err.message}` });
  }
});

router.post('/logo', authenticate, requireRoles('ADMIN'), upload.single('logo'), async (req, res) => {
  if (!req.file) { res.status(400).json({ message: 'No se recibió ningún archivo' }); return; }
  try {
    const existing = await prisma.company.findFirst();
    if (existing?.logoUrl) {
      await deleteFile(existing.logoUrl).catch(() => {});
    }
    const url = await uploadFile(req.file.buffer, req.file.mimetype, 'logos');
    const company = existing
      ? await prisma.company.update({ where: { id: existing.id }, data: { logoUrl: url }, select: SAFE_SELECT })
      : await prisma.company.create({ data: { name: 'Mi Empresa', logoUrl: url }, select: SAFE_SELECT });
    res.json(company);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/logo', authenticate, requireRoles('ADMIN'), async (_req, res) => {
  const existing = await prisma.company.findFirst();
  if (!existing) { res.status(404).json({ message: 'No hay empresa configurada' }); return; }
  if (existing.logoUrl) {
    await deleteFile(existing.logoUrl).catch(() => {});
  }
  const company = await prisma.company.update({
    where: { id: existing.id },
    data: { logoUrl: null },
    select: SAFE_SELECT,
  });
  res.json(company);
});

export default router;
