import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import * as hd from '../controllers/helpdesk.controller';

const router = Router();

// Public routes (no auth required)
router.post('/tickets', hd.createTicket);
router.get('/track/:token', hd.trackByToken);

// Internal routes (authenticated)
router.get('/tickets', authenticate, hd.listTickets);
router.get('/tickets/:id', authenticate, hd.getTicket);
router.patch('/tickets/:id/status', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF', 'TECHNICIAN'), hd.updateStatus);
router.post('/tickets/:id/assign', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), hd.assignTicket);
router.patch('/tickets/:id/equipment', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF', 'TECHNICIAN'), hd.assignEquipment);
router.post('/tickets/:id/comments', authenticate, hd.addComment);
router.post('/tickets/:id/convert', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF', 'TECHNICIAN'), hd.convertToWO);

export default router;
