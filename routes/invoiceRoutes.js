import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getAll, getStats, getById,
  create, bulkUpload, update, updateStatus,
  remove, removeAll, sendEmail, migrateTypes, getByInvoiceNo, createFromSalesOrder,
  sendToTally, renormalizeAll,
} from '../controllers/invoiceController.js';

const router = express.Router();

router.use(protect);

router.get('/',                    getAll);
router.get('/stats',               getStats);
router.get('/no/:invoiceNo',       getByInvoiceNo);
router.post('/',                   create);
router.post('/from-order/:orderId', createFromSalesOrder);
router.post('/bulk-upload',        bulkUpload);
router.post('/delete-all',         removeAll);
router.post('/migrate-types',      migrateTypes);
router.post('/renormalize-all',    renormalizeAll);
router.get('/:id',                 getById);
router.put('/:id',                 update);
router.patch('/:id/status',        updateStatus);
router.post('/:id/send-email',     sendEmail);
router.post('/:id/send-to-tally',  sendToTally);
router.delete('/:id',              remove);

export default router;
