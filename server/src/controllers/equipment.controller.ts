import { Request, Response } from 'express';
import { Prisma, EquipmentType, EquipmentStatus } from '@prisma/client';
import QRCode from 'qrcode';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

const include = {
  location: { include: { branch: true } },
} satisfies Prisma.EquipmentInclude;

export async function list(req: Request, res: Response): Promise<void> {
  const { branchId, type, status, search, page = '1', limit = '25' } = req.query as Record<string, string>;

  const where: Prisma.EquipmentWhereInput = {};
  if (type) where.type = type as EquipmentType;
  if (status) where.status = status as EquipmentStatus;
  if (branchId) where.location = { branchId };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { serialNumber: { contains: search, mode: 'insensitive' } },
      { brand: { contains: search, mode: 'insensitive' } },
    ];
  }

  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));

  const [data, total] = await Promise.all([
    prisma.equipment.findMany({ where, include, skip: (p - 1) * l, take: l, orderBy: { name: 'asc' } }),
    prisma.equipment.count({ where }),
  ]);

  res.json({ data, total, page: p, limit: l });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const equipment = await prisma.equipment.findUnique({
    where: { id: req.params.id },
    include: {
      ...include,
      maintenancePlans: {
        where: { active: true },
        orderBy: { nextDueDate: 'asc' },
      },
      _count: { select: { workOrders: true } },
    },
  });
  if (!equipment) { res.status(404).json({ message: 'Equipo no encontrado' }); return; }
  res.json(equipment);
}

export async function getByCode(req: Request, res: Response): Promise<void> {
  const equipment = await prisma.equipment.findUnique({
    where: { code: req.params.code },
    include,
  });
  if (!equipment) { res.status(404).json({ message: 'Equipo no encontrado' }); return; }
  res.json(equipment);
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  const { code, name, type, category, subcategory, serialNumber, brand, model,
          year, locationId, assetNumber, purchaseDate, purchaseValue, notes } = req.body;

  const qrCode = `${process.env.CLIENT_URL || 'http://localhost:5173'}/equipo/${code}/acceso`;

  try {
    const equipment = await prisma.equipment.create({
      data: {
        code,
        qrCode,
        name,
        type,
        category,
        subcategory: subcategory || null,
        serialNumber: serialNumber || null,
        brand: brand || null,
        model: model || null,
        year: year ? Number(year) : null,
        locationId,
        assetNumber: assetNumber || null,
        purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
        purchaseValue: purchaseValue ? Number(purchaseValue) : null,
        notes: notes || null,
      },
      include,
    });
    res.status(201).json(equipment);
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ message: 'El código de equipo ya existe' });
      return;
    }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const { name, type, category, subcategory, serialNumber, brand, model,
          year, locationId, assetNumber, purchaseDate, purchaseValue, status, notes } = req.body;

  const equipment = await prisma.equipment.update({
    where: { id: req.params.id },
    data: {
      name,
      type,
      category,
      subcategory: subcategory ?? null,
      serialNumber: serialNumber ?? null,
      brand: brand ?? null,
      model: model ?? null,
      year: year !== undefined ? (year ? Number(year) : null) : undefined,
      locationId,
      assetNumber: assetNumber ?? null,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
      purchaseValue: purchaseValue !== undefined ? (purchaseValue ? Number(purchaseValue) : null) : undefined,
      status,
      notes: notes ?? null,
    },
    include,
  });
  res.json(equipment);
}

export async function getQR(req: Request, res: Response): Promise<void> {
  const equipment = await prisma.equipment.findUnique({
    where: { id: req.params.id },
    select: { qrCode: true, code: true, name: true },
  });
  if (!equipment) { res.status(404).json({ message: 'Equipo no encontrado' }); return; }

  const dataUrl = await QRCode.toDataURL(equipment.qrCode, {
    width: 400,
    margin: 2,
    color: { dark: '#0f172a', light: '#ffffff' },
  });

  res.json({ dataUrl, code: equipment.code, name: equipment.name, url: equipment.qrCode });
}

export async function history(req: Request, res: Response): Promise<void> {
  const workOrders = await prisma.workOrder.findMany({
    where: { equipmentId: req.params.id },
    include: {
      technician: { select: { id: true, name: true } },
      provider: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(workOrders);
}

export async function report(req: Request, res: Response): Promise<void> {
  const { from, to } = req.query as { from?: string; to?: string };

  const where: Prisma.WorkOrderWhereInput = { equipmentId: req.params.id };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [equipment, workOrders] = await Promise.all([
    prisma.equipment.findUnique({ where: { id: req.params.id }, include }),
    prisma.workOrder.findMany({
      where,
      include: {
        technician: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } },
        spareParts: { include: { sparePart: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  if (!equipment) { res.status(404).json({ message: 'Equipo no encontrado' }); return; }

  const company = await prisma.company.findFirst({
    select: { name: true, logoUrl: true, nit: true },
  });

  res.json({ equipment, workOrders, company });
}
