import express from 'express';
import {
  getAllDockets,
  getDocketById,
  createDocket,
  updateDocket,
  updateDocketStatus,
  deleteDocket,
  trackByLRNumber,
  getDashboardStats,
  getDelayedDockets,
  bulkUpdateStatus,
  uploadPOD,
  uploadAttachment,
  getTrackingTimeline,
  closeDocket
} from '../controllers/docketTrackingController.js';

const router = express.Router();

// Dashboard and statistics routes
router.get('/stats', getDashboardStats);
router.get('/delayed', getDelayedDockets);

// CRUD routes
router.get('/', getAllDockets);
router.get('/:id', getDocketById);
router.post('/', createDocket);
router.put('/:id', updateDocket);
router.delete('/:id', deleteDocket);

// Status management
router.patch('/:id/status', updateDocketStatus);
router.patch('/bulk/status', bulkUpdateStatus);

// Tracking routes
router.get('/track/:lrNumber', trackByLRNumber);
router.get('/:id/timeline', getTrackingTimeline);

// File upload routes
router.post('/:id/pod', uploadPOD);
router.post('/:id/attachment', uploadAttachment);

// Docket closure
router.patch('/:id/close', closeDocket);

export default router;