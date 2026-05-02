import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { AuthRequest } from '../middleware/auth';
import * as emailService from '../services/email.service';

const prisma = new PrismaClient();

const SLA_HOURS: Record<string, number> = {
  CRITICAL: 1,
  HIGH: 4,
  MEDIUM: 24,
  LOW: 72,
};

// POST /helpdesk/tickets (public — no auth)
export async function createTicket(req: Request, res: Response) {
  try {
    const {
      requesterName, requesterEmail, requesterPhone,
      branchId, area, requestType, priority, description, equipmentId,
    } = req.body;

    if (!requesterName || !requesterEmail || !branchId || !area || !requestType || !priority || !description) {
      return res.status(400).json({ message: 'Faltan campos requeridos' });
    }

    const year = new Date().getFullYear();
    const count = await prisma.helpdeskTicket.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    const code = `HD-${year}-${String(count + 1).padStart(4, '0')}`;
    const trackingToken = crypto.randomBytes(32).toString('hex');
    const slaHours = SLA_HOURS[priority] ?? 24;
    const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000);

    const ticket = await prisma.helpdeskTicket.create({
      data: {
        code,
        trackingToken,
        requesterName: requesterName.trim(),
        requesterEmail: requesterEmail.trim().toLowerCase(),
        requesterPhone: requesterPhone?.trim() || null,
        branchId,
        area: area.trim(),
        requestType,
        priority,
        description: description.trim(),
        equipmentId: equipmentId || null,
        status: 'OPEN',
        slaHours,
        slaDeadline,
      },
    });

    // Email to requester
    await emailService.sendTicketCreated({
      to: ticket.requesterEmail,
      requesterName: ticket.requesterName,
      ticketCode: ticket.code,
      trackingToken: ticket.trackingToken,
      description: ticket.description,
    });

    // Notify all active maintenance staff
    const staff = await prisma.user.findMany({
      where: { role: { in: ['MAINTENANCE_CHIEF', 'TECHNICIAN'] }, active: true },
      select: { email: true },
    });
    for (const u of staff) {
      await emailService.sendNewTicketNotification({
        to: u.email,
        ticketCode: ticket.code,
        requesterName: ticket.requesterName,
        priority: ticket.priority,
        description: ticket.description,
        area: ticket.area,
      });
    }

    res.status(201).json({
      id: ticket.id,
      code: ticket.code,
      trackingToken: ticket.trackingToken,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear el ticket' });
  }
}

// GET /helpdesk/track/:token (public — no auth)
export async function trackByToken(req: Request, res: Response) {
  try {
    const { token } = req.params;
    const ticket = await prisma.helpdeskTicket.findUnique({
      where: { trackingToken: token },
      include: {
        branch: { select: { name: true } },
        equipment: { select: { name: true, code: true } },
        comments: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) return res.status(404).json({ message: 'Ticket no encontrado' });

    // Strip private fields before returning
    const { trackingToken: _token, assignedToId: _a, ...pub } = ticket as any;
    res.json(pub);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al buscar el ticket' });
  }
}

// GET /helpdesk/tickets (internal — authenticated)
export async function listTickets(req: AuthRequest, res: Response) {
  try {
    const { status, priority, branchId, assignedToId, search, page = '1', limit = '25' } = req.query as Record<string, string>;

    const where: any = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (branchId) where.branchId = branchId;
    if (assignedToId === 'unassigned') {
      where.assignedToId = null;
    } else if (assignedToId) {
      where.assignedToId = assignedToId;
    }
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { requesterName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { area: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [data, total] = await Promise.all([
      prisma.helpdeskTicket.findMany({
        where,
        include: {
          branch: { select: { name: true } },
          equipment: { select: { name: true, code: true } },
          assignedTo: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: parseInt(limit),
      }),
      prisma.helpdeskTicket.count({ where }),
    ]);

    res.json({ data, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al listar tickets' });
  }
}

// GET /helpdesk/tickets/:id (internal)
export async function getTicket(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const ticket = await prisma.helpdeskTicket.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true } },
        equipment: { select: { id: true, name: true, code: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        comments: { orderBy: { createdAt: 'asc' } },
        workOrders: {
          select: { id: true, code: true, status: true, type: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!ticket) return res.status(404).json({ message: 'Ticket no encontrado' });
    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el ticket' });
  }
}

// PATCH /helpdesk/tickets/:id/status (internal)
export async function updateStatus(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { status, resolutionNotes } = req.body;

    if (!status) return res.status(400).json({ message: 'Estado requerido' });

    const ticket = await prisma.helpdeskTicket.findUnique({
      where: { id },
      include: { workOrders: { select: { id: true }, take: 1 } },
    });
    if (!ticket) return res.status(404).json({ message: 'Ticket no encontrado' });

    // Require at least one WO to resolve or close
    if (['RESOLVED', 'CLOSED'].includes(status) && ticket.workOrders.length === 0) {
      return res.status(400).json({ message: 'Debe crear una Orden de Trabajo antes de cerrar el ticket' });
    }

    const updateData: any = { status };
    if (status === 'RESOLVED') updateData.resolvedAt = new Date();
    if (status === 'CLOSED') { updateData.resolvedAt = ticket.resolvedAt ?? new Date(); updateData.closedAt = new Date(); }
    if (resolutionNotes) updateData.resolutionNotes = resolutionNotes;

    const updated = await prisma.helpdeskTicket.update({ where: { id }, data: updateData });

    await prisma.ticketComment.create({
      data: {
        ticketId: id,
        authorName: 'Sistema',
        content: `Estado actualizado a: ${status}${resolutionNotes ? ` — ${resolutionNotes}` : ''}`,
        isInternal: false,
      },
    });

    await emailService.sendTicketStatusUpdate({
      to: ticket.requesterEmail,
      requesterName: ticket.requesterName,
      ticketCode: ticket.code,
      trackingToken: ticket.trackingToken,
      newStatus: status,
      comment: resolutionNotes,
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar estado' });
  }
}

// POST /helpdesk/tickets/:id/assign (internal)
export async function assignTicket(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ message: 'userId requerido' });

    const [ticket, user] = await Promise.all([
      prisma.helpdeskTicket.findUnique({ where: { id } }),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    ]);
    if (!ticket) return res.status(404).json({ message: 'Ticket no encontrado' });
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const updated = await prisma.helpdeskTicket.update({
      where: { id },
      data: {
        assignedToId: userId,
        status: ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status,
      },
    });

    await prisma.ticketComment.create({
      data: {
        ticketId: id,
        authorName: 'Sistema',
        content: `Asignado a: ${user.name}`,
        isInternal: true,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al asignar ticket' });
  }
}

// POST /helpdesk/tickets/:id/comments (internal)
export async function addComment(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { content, isInternal = false } = req.body;

    if (!content?.trim()) return res.status(400).json({ message: 'El comentario no puede estar vacío' });

    const [ticket, author] = await Promise.all([
      prisma.helpdeskTicket.findUnique({ where: { id } }),
      prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } }),
    ]);
    if (!ticket) return res.status(404).json({ message: 'Ticket no encontrado' });

    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: id,
        authorId: req.user!.userId,
        authorName: author?.name ?? 'Técnico',
        content: content.trim(),
        isInternal: Boolean(isInternal),
      },
    });

    // Send email to requester only for public comments
    if (!isInternal) {
      await emailService.sendTicketComment({
        to: ticket.requesterEmail,
        requesterName: ticket.requesterName,
        ticketCode: ticket.code,
        trackingToken: ticket.trackingToken,
        authorName: author?.name ?? 'Técnico',
        comment: content.trim(),
      });
    }

    res.status(201).json(comment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al agregar comentario' });
  }
}

// PATCH /helpdesk/tickets/:id/equipment (internal — technician assigns equipment on-site)
export async function assignEquipment(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { equipmentId } = req.body;

    const ticket = await prisma.helpdeskTicket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ message: 'Ticket no encontrado' });
    if (ticket.status === 'CLOSED') {
      return res.status(400).json({ message: 'No se puede modificar un ticket cerrado' });
    }

    if (equipmentId) {
      const eq = await prisma.equipment.findUnique({ where: { id: equipmentId } });
      if (!eq) return res.status(404).json({ message: 'Equipo no encontrado' });
    }

    const updated = await prisma.helpdeskTicket.update({
      where: { id },
      data: { equipmentId: equipmentId || null },
      include: { equipment: { include: { location: { include: { branch: true } } } } },
    });

    await prisma.ticketComment.create({
      data: {
        ticketId: id,
        authorName: 'Sistema',
        content: equipmentId
          ? `Equipo asignado: ${updated.equipment?.name} (${updated.equipment?.code})`
          : 'Equipo desvinculado del ticket.',
        isInternal: true,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al asignar equipo' });
  }
}

// POST /helpdesk/tickets/:id/convert (internal)
export async function convertToWO(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { technicianId, providerId, priority, notes } = req.body;

    const ticket = await prisma.helpdeskTicket.findUnique({
      where: { id },
      include: {
        workOrders: { take: 1 },
        branch: { select: { name: true } },
      },
    });
    if (!ticket) return res.status(404).json({ message: 'Ticket no encontrado' });
    if (ticket.workOrders.length > 0) {
      return res.status(400).json({ message: 'Este ticket ya tiene una orden de trabajo asociada' });
    }

    const year = new Date().getFullYear();
    const count = await prisma.workOrder.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    const woCode = `OT-${year}-${String(count + 1).padStart(4, '0')}`;

    // Use equipment if assigned; otherwise create general WO with location from ticket
    const locationDescription = ticket.equipmentId
      ? null
      : `${ticket.code} — ${ticket.area}${ticket.branch ? ` · ${(ticket.branch as any).name}` : ''}`;

    const wo = await prisma.workOrder.create({
      data: {
        code: woCode,
        type: 'CORRECTIVE',
        priority: priority || ticket.priority,
        status: 'OPEN',
        equipmentId: ticket.equipmentId || null,
        locationDescription,
        technicianId: technicianId || null,
        providerId: providerId || null,
        helpdeskTicketId: id,
        scheduledDate: new Date(),
        notes: notes || ticket.description,
      },
    });

    await prisma.helpdeskTicket.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
    });

    await prisma.ticketComment.create({
      data: {
        ticketId: id,
        authorName: 'Sistema',
        content: `Se generó la orden de trabajo ${woCode} a partir de este ticket.`,
        isInternal: false,
      },
    });

    await emailService.sendTicketStatusUpdate({
      to: ticket.requesterEmail,
      requesterName: ticket.requesterName,
      ticketCode: ticket.code,
      trackingToken: ticket.trackingToken,
      newStatus: 'IN_PROGRESS',
      comment: `Se creó la orden de trabajo ${woCode} para atender su solicitud.`,
    });

    res.status(201).json(wo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al convertir ticket a OT' });
  }
}
