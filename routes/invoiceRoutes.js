import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getAll, getStats, getById,
  create, bulkUpload, update, updateStatus,
  remove, removeAll, sendEmail,
} from '../controllers/invoiceController.js';

const router = express.Router();

router.use(protect);

router.get('/',                    getAll);
router.get('/stats',               getStats);
router.post('/',                   create);
router.post('/bulk-upload',        bulkUpload);
router.post('/delete-all',         removeAll);
router.get('/:id',                 getById);
router.put('/:id',                 update);
router.patch('/:id/status',        updateStatus);
router.post('/:id/send-email',     sendEmail);
router.delete('/:id',              remove);

export default router;
