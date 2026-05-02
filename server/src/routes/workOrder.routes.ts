import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import { upload } from '../middleware/upload';
import {
  list, getById, create, updateStatus, updateChecklist,
  uploadImages, saveSignatures, addSpareParts, removeSparePart,
  closeWO, getPDF,
} from '../controllers/workOrder.controller';

const router = Router();

router.get('/', authenticate, list);
router.get('/:id', authenticate, getById);
router.get('/:id/pdf', authenticate, getPDF);

router.post('/', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF', 'TECHNICIAN'), create);
router.patch('/:id/status', authenticate, updateStatus);
router.patch('/:id/checklist', authenticate, updateChecklist);
router.post('/:id/images', authenticate, upload.single('image'), uploadImages);
router.post('/:id/signatures', authenticate, saveSignatures);
router.post('/:id/spare-parts', authenticate, addSpareParts);
router.delete('/:id/spare-parts/:sparePartId', authenticate, removeSparePart);
router.post('/:id/close', authenticate, closeWO);

export default router;
