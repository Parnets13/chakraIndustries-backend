import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getAll, getStats, getById,
  create, bulkUpload, update, updateStatus, remove,
} from '../controllers/invoiceController.js';

const router = express.Router();

router.use(protect);

router.get('/',              getAll);
router.get('/stats',         getStats);
router.get('/:id',           getById);
router.post('/',             create);
router.post('/bulk-upload',  bulkUpload);
router.put('/:id',           update);
router.patch('/:id/status',  updateStatus);
router.delete('/:id',        remove);

export default router;
