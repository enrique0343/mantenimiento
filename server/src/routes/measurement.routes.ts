import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { sendPredictiveAlert } from '../services/email.service';

const router = Router();

// GET /measurements/:equipmentId?days=90
router.get('/:equipmentId', authenticate, async (req, res) => {
  const days = Number(req.query.days) || 90;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.predictiveMeasurement.findMany({
    where: { equipmentId: req.params.equipmentId, recordedAt: { gte: since } },
    include: { recordedBy: { select: { id: true, name: true } } },
    orderBy: { recordedAt: 'asc' },
  });

  // Group by variable; latest thresholds win (rows are asc so last assignment = latest)
  const grouped: Record<string, any> = {};
  for (const r of rows) {
    if (!grouped[r.variable]) {
      grouped[r.variable] = { variable: r.variable, unit: r.unit, measurements: [], minThreshold: null, maxThreshold: null };
    }
    grouped[r.variable].measurements.push({ ...r, value: Number(r.value) });
    if (r.minThreshold !== null) grouped[r.variable].minThreshold = Number(r.minThreshold);
    if (r.maxThreshold !== null) grouped[r.variable].maxThreshold = Number(r.maxThreshold);
  }

  // Also expose variables that exist but have no recent data
  const allVars = await prisma.predictiveMeasurement.findMany({
    where: { equipmentId: req.params.equipmentId },
    select: { variable: true, unit: true, minThreshold: true, maxThreshold: true },
    distinct: ['variable'],
    orderBy: { variable: 'asc' },
  });
  for (const v of allVars) {
    if (!grouped[v.variable]) {
      grouped[v.variable] = {
        variable: v.variable, unit: v.unit, measurements: [],
        minThreshold: v.minThreshold !== null ? Number(v.minThreshold) : null,
        maxThreshold: v.maxThreshold !== null ? Number(v.maxThreshold) : null,
      };
    }
  }

  res.json(Object.values(grouped));
});

// POST /measurements — record a new measurement
router.post('/', authenticate, async (req: AuthRequest, res) => {
  const { equipmentId, variable, unit, value, minThreshold, maxThreshold, notes } = req.body;
  const recordedById = req.user!.id;

  // Inherit thresholds from last measurement if not provided
  let resolvedMin: any = minThreshold !== undefined && minThreshold !== '' ? Number(minThreshold) : null;
  let resolvedMax: any = maxThreshold !== undefined && maxThreshold !== '' ? Number(maxThreshold) : null;

  if (resolvedMin === null && resolvedMax === null) {
    const last = await prisma.predictiveMeasurement.findFirst({
      where: { equipmentId, variable },
      orderBy: { recordedAt: 'desc' },
      select: { minThreshold: true, maxThreshold: true },
    });
    if (last) {
      resolvedMin = last.minThreshold;
      resolvedMax = last.maxThreshold;
    }
  }

  const numValue = Number(value);
  const inAlert =
    (resolvedMin !== null && numValue < Number(resolvedMin)) ||
    (resolvedMax !== null && numValue > Number(resolvedMax));

  const measurement = await prisma.predictiveMeasurement.create({
    data: {
      equipmentId, variable, unit, value: numValue, notes,
      minThreshold: resolvedMin, maxThreshold: resolvedMax,
      alertSent: inAlert, recordedById,
    },
    include: {
      equipment: { select: { name: true, code: true } },
      recordedBy: { select: { name: true } },
    },
  });

  if (inAlert) {
    const recipients = await prisma.user.findMany({
      where: { active: true, role: { in: ['ADMIN', 'MAINTENANCE_CHIEF'] } },
      select: { email: true },
    });
    for (const r of recipients) {
      sendPredictiveAlert({
        to: r.email,
        equipmentName: (measurement as any).equipment.name,
        equipmentCode: (measurement as any).equipment.code,
        variable,
        unit,
        value: numValue,
        minThreshold: resolvedMin !== null ? Number(resolvedMin) : undefined,
        maxThreshold: resolvedMax !== null ? Number(resolvedMax) : undefined,
        recordedBy: (measurement as any).recordedBy.name,
      }).catch(() => {});
    }
  }

  res.status(201).json({ ...measurement, value: Number(measurement.value), inAlert });
});

// PUT /measurements/thresholds — update thresholds for a variable across all its records
router.put('/thresholds', authenticate, async (req, res) => {
  const { equipmentId, variable, minThreshold, maxThreshold } = req.body;

  await prisma.predictiveMeasurement.updateMany({
    where: { equipmentId, variable },
    data: {
      minThreshold: minThreshold !== '' && minThreshold != null ? Number(minThreshold) : null,
      maxThreshold: maxThreshold !== '' && maxThreshold != null ? Number(maxThreshold) : null,
    },
  });

  res.json({ message: 'Umbrales actualizados' });
});

export default router;
