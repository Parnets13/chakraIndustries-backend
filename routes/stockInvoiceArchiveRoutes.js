import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getAll, getStats, getById, updateStatus, syncFromInvoices, remove, removeAll,
} from '../controllers/stockInvoiceArchiveController.js';

const router = express.Router();

router.use(protect);

router.get('/',             getAll);
router.get('/stats',        getStats);
router.post('/sync',        syncFromInvoices);
router.post('/delete-all',  removeAll);
router.get('/:id',          getById);
router.patch('/:id/status', updateStatus);
router.delete('/:id',       remove);

export default router;
