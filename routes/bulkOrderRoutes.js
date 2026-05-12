import express from 'express';
import {
  getClients, createClient, updateClient, deleteClient,
  getQuotations, createQuotation, updateQuotation, updateQuotationStatus, deleteQuotation,
  getSchedules, createSchedule, updateSchedule, deleteSchedule,
  getBulkStats, convertToDispatch,
} from '../controllers/bulkOrderController.js';

const router = express.Router();

// Stats
router.get('/stats', getBulkStats);

// Corporate Clients
router.get('/clients', getClients);
router.post('/clients', createClient);
router.put('/clients/:id', updateClient);
router.delete('/clients/:id', deleteClient);

// Bulk Quotations
router.get('/quotations', getQuotations);
router.post('/quotations', createQuotation);
router.put('/quotations/:id', updateQuotation);
router.patch('/quotations/:id/status', updateQuotationStatus);
router.delete('/quotations/:id', deleteQuotation);
router.post('/quotations/:id/convert-to-dispatch', convertToDispatch);

// Delivery Schedules
router.get('/schedules', getSchedules);
router.post('/schedules', createSchedule);
router.put('/schedules/:id', updateSchedule);
router.delete('/schedules/:id', deleteSchedule);

export default router;
