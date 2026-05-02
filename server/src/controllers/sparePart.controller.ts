import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { sendLowStockAlert } from '../services/email.service';

// GET /spare-parts
export async function list(req: AuthRequest, res: Response) {
  try {
    const { search, category, branchId, page = '1', limit = '50' } = req.query as Record<string, string>;

    const where: any = { active: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (category) where.category = category;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [data, total] = await Promise.all([
      prisma.sparePart.findMany({
        where,
        include: {
          stocks: branchId
            ? { where: { branchId }, include: { branch: { select: { name: true } } } }
            : { include: { branch: { select: { name: true } } } },
          provider: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.sparePart.count({ where }),
    ]);

    res.json({ data, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al listar repuestos' });
  }
}

// GET /spare-parts/alerts
export async function alerts(req: AuthRequest, res: Response) {
  try {
    const { branchId } = req.query as Record<string, string>;

    const stockWhere: any = {};
    if (branchId) stockWhere.branchId = branchId;

    const stocks = await prisma.sparePartStock.findMany({
      where: {
        ...stockWhere,
        sparePart: { active: true },
      },
      include: {
        sparePart: { select: { id: true, name: true, code: true, unit: true } },
        branch: { select: { name: true } },
      },
    });

    const alerts = stocks.filter(s => s.quantity <= s.minStock && s.minStock > 0);
    res.json(alerts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener alertas' });
  }
}

// GET /spare-parts/:id
export async function getById(req: AuthRequest, res: Response) {
  try {
    const part = await prisma.sparePart.findUnique({
      where: { id: req.params.id },
      include: {
        stocks: { include: { branch: { select: { name: true } } } },
        provider: { select: { id: true, name: true } },
      },
    });
    if (!part) return res.status(404).json({ message: 'Repuesto no encontrado' });
    res.json(part);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el repuesto' });
  }
}

// GET /spare-parts/:id/movements
export async function movements(req: AuthRequest, res: Response) {
  try {
    const { branchId, page = '1', limit = '30' } = req.query as Record<string, string>;
    const where: any = { sparePartId: req.params.id };
    if (branchId) where.branchId = branchId;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [data, total] = await Promise.all([
      prisma.sparePartMovement.findMany({
        where,
        include: {
          createdBy: { select: { name: true } },
          sparePart: { select: { name: true, unit: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.sparePartMovement.count({ where }),
    ]);

    res.json({ data, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener movimientos' });
  }
}

// POST /spare-parts
export async function create(req: AuthRequest, res: Response) {
  try {
    const { code, name, description, unit, category, providerId, initialStocks } = req.body;
    if (!code || !name || !unit) return res.status(400).json({ message: 'Código, nombre y unidad son requeridos' });

    const part = await prisma.sparePart.create({
      data: {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description?.trim() || null,
        unit: unit.trim(),
        category: category?.trim() || null,
        providerId: providerId || null,
      },
    });

    // Create initial stock records per branch if provided
    if (Array.isArray(initialStocks)) {
      for (const s of initialStocks) {
        if (!s.branchId) continue;
        await prisma.sparePartStock.create({
          data: {
            sparePartId: part.id,
            branchId: s.branchId,
            quantity: parseInt(s.quantity) || 0,
            minStock: parseInt(s.minStock) || 0,
          },
        });
        if (parseInt(s.quantity) > 0) {
          await prisma.sparePartMovement.create({
            data: {
              sparePartId: part.id,
              branchId: s.branchId,
              type: 'IN',
              quantity: parseInt(s.quantity),
              notes: 'Stock inicial',
              createdById: req.user!.userId,
            },
          });
        }
      }
    }

    res.status(201).json(part);
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ message: 'El código ya existe' });
    console.error(err);
    res.status(500).json({ message: 'Error al crear el repuesto' });
  }
}

// PUT /spare-parts/:id
export async function update(req: AuthRequest, res: Response) {
  try {
    const { name, description, unit, category, providerId } = req.body;
    const part = await prisma.sparePart.findUnique({ where: { id: req.params.id } });
    if (!part) return res.status(404).json({ message: 'Repuesto no encontrado' });

    const updated = await prisma.sparePart.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(unit !== undefined && { unit: unit.trim() }),
        ...(category !== undefined && { category: category?.trim() || null }),
        ...(providerId !== undefined && { providerId: providerId || null }),
      },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar el repuesto' });
  }
}

// PATCH /spare-parts/:id/stock  — manual stock adjustment
export async function adjustStock(req: AuthRequest, res: Response) {
  try {
    const { branchId, quantity, type = 'ADJUSTMENT', notes } = req.body;
    if (!branchId || quantity === undefined) {
      return res.status(400).json({ message: 'branchId y quantity son requeridos' });
    }

    const delta = parseInt(quantity);
    if (isNaN(delta)) return res.status(400).json({ message: 'quantity debe ser un número' });

    // Upsert stock record
    const stock = await prisma.sparePartStock.upsert({
      where: { sparePartId_branchId: { sparePartId: req.params.id, branchId } },
      create: { sparePartId: req.params.id, branchId, quantity: Math.max(0, delta), minStock: 0 },
      update: { quantity: { increment: delta } },
      include: { branch: { select: { name: true } }, sparePart: { select: { name: true, code: true } } },
    });

    // Ensure quantity doesn't go negative
    if (stock.quantity < 0) {
      await prisma.sparePartStock.update({
        where: { sparePartId_branchId: { sparePartId: req.params.id, branchId } },
        data: { quantity: 0 },
      });
      stock.quantity = 0;
    }

    // Record movement
    await prisma.sparePartMovement.create({
      data: {
        sparePartId: req.params.id,
        branchId,
        type,
        quantity: Math.abs(delta),
        notes: notes?.trim() || null,
        createdById: req.user!.userId,
      },
    });

    // Check low stock alert
    if (stock.minStock > 0 && stock.quantity <= stock.minStock) {
      const chiefs = await prisma.user.findMany({
        where: { role: { in: ['MAINTENANCE_CHIEF', 'ADMIN'] }, active: true },
        select: { email: true },
      });
      for (const u of chiefs) {
        await sendLowStockAlert({
          to: u.email,
          partName: stock.sparePart.name,
          partCode: stock.sparePart.code,
          branchName: stock.branch.name,
          currentStock: stock.quantity,
          minStock: stock.minStock,
        });
      }
    }

    res.json(stock);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al ajustar stock' });
  }
}

// PATCH /spare-parts/:id/min-stock  — update minimum stock threshold
export async function setMinStock(req: AuthRequest, res: Response) {
  try {
    const { branchId, minStock } = req.body;
    if (!branchId || minStock === undefined) {
      return res.status(400).json({ message: 'branchId y minStock son requeridos' });
    }

    const stock = await prisma.sparePartStock.upsert({
      where: { sparePartId_branchId: { sparePartId: req.params.id, branchId } },
      create: { sparePartId: req.params.id, branchId, quantity: 0, minStock: parseInt(minStock) },
      update: { minStock: parseInt(minStock) },
    });

    res.json(stock);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar stock mínimo' });
  }
}

// GET /spare-parts/consumption-report
export async function consumptionReport(req: AuthRequest, res: Response) {
  try {
    const { branchId, from, to } = req.query as Record<string, string>;

    const where: any = { type: 'OUT' };
    if (branchId) where.branchId = branchId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const movements = await prisma.sparePartMovement.findMany({
      where,
      include: {
        sparePart: { select: { code: true, name: true, unit: true, category: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with WO and area info
    const enriched = await Promise.all(
      movements.map(async (m) => {
        if (!m.workOrderId) return { ...m, workOrder: null, area: null };
        const wo = await prisma.workOrder.findUnique({
          where: { id: m.workOrderId },
          select: {
            code: true,
            type: true,
            equipment: { select: { name: true, location: { select: { area: true, branch: { select: { name: true } } } } } },
          },
        });
        return {
          ...m,
          workOrder: wo,
          area: wo?.equipment?.location?.area ?? null,
          branchName: wo?.equipment?.location?.branch?.name ?? null,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al generar reporte de consumo' });
  }
}

// PATCH /spare-parts/:id/safety-stock — update reorder point and safety stock
export async function setSafetyStock(req: AuthRequest, res: Response) {
  try {
    const { branchId, reorderPoint, safetyStock, minStock } = req.body;
    if (!branchId) return res.status(400).json({ message: 'branchId requerido' });

    const stock = await prisma.sparePartStock.upsert({
      where: { sparePartId_branchId: { sparePartId: req.params.id, branchId } },
      create: {
        sparePartId: req.params.id,
        branchId,
        quantity: 0,
        minStock: minStock !== undefined ? parseInt(minStock) : 0,
        reorderPoint: reorderPoint !== undefined ? parseInt(reorderPoint) : 0,
        safetyStock: safetyStock !== undefined ? parseInt(safetyStock) : 0,
      },
      update: {
        ...(minStock !== undefined && { minStock: parseInt(minStock) }),
        ...(reorderPoint !== undefined && { reorderPoint: parseInt(reorderPoint) }),
        ...(safetyStock !== undefined && { safetyStock: parseInt(safetyStock) }),
      },
    });
    res.json(stock);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar stock de seguridad' });
  }
}

// DELETE /spare-parts/:id (soft delete)
export async function deactivate(req: AuthRequest, res: Response) {
  try {
    await prisma.sparePart.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al desactivar repuesto' });
  }
}
