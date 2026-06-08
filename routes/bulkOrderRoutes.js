import express from 'express';
import {
  getClients, createClient, updateClient, deleteClient,
  importClients,
  importClientsFromFile,
  getQuotations, createQuotation, updateQuotation, updateQuotationStatus, deleteQuotation,
  getSchedules, createSchedule, updateSchedule, deleteSchedule,
  getBulkStats, convertToDispatch, convertToPO,
} from '../controllers/bulkOrderController.js';
import { protect } from '../middleware/authMiddleware.js';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
router.use(protect);

// Stats
router.get('/stats', getBulkStats);

// Corporate Clients
router.get('/clients', getClients);
router.post('/clients', protect, createClient);
router.post('/clients/import', protect, importClients);
router.post('/clients/import-file', protect, upload.single('file'), importClientsFromFile);
router.put('/clients/:id', protect, updateClient);
router.delete('/clients/:id', protect, deleteClient);

// Bulk Quotations
router.get('/quotations', getQuotations);
router.post('/quotations', createQuotation);
router.put('/quotations/:id', updateQuotation);
router.patch('/quotations/:id/status', updateQuotationStatus);
router.delete('/quotations/:id', deleteQuotation);
router.post('/quotations/:id/convert-to-dispatch', convertToDispatch);
router.post('/quotations/:id/convert-to-po', convertToPO);

// Delivery Schedules
router.get('/schedules', getSchedules);
router.post('/schedules', protect, createSchedule);
router.put('/schedules/:id', protect, updateSchedule);
router.delete('/schedules/:id', protect, deleteSchedule);

export default router;
