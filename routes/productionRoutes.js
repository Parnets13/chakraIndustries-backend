import express from 'express';
import {
  createBOM,
  getBOMs,
  getBOMById,
  updateBOM,
  deleteBOM,
  createWorkOrder,
  getWorkOrders,
  getWorkOrderById,
  updateWorkOrder,
  updateWorkOrderProgress,
  deleteWorkOrder,
  getProductionStats,
  calculateMaterialRequirements,
  checkInventoryStatus,
  approveWorkOrder,
  rejectWorkOrder,
  completeWorkOrder
} from '../controllers/productionController.js';

const router = express.Router();

// BOM routes
router.post('/boms', createBOM);
router.get('/boms', getBOMs);
router.get('/boms/:id', getBOMById);
router.put('/boms/:id', updateBOM);
router.delete('/boms/:id', deleteBOM);

// Work Order routes
router.post('/work-orders', createWorkOrder);
router.get('/work-orders', getWorkOrders);
router.get('/work-orders/:id', getWorkOrderById);
router.put('/work-orders/:id', updateWorkOrder);
router.put('/work-orders/:id/progress', updateWorkOrderProgress);
router.delete('/work-orders/:id', deleteWorkOrder);

// Inventory & Approval routes
router.post('/work-orders/calculate-requirements', calculateMaterialRequirements);
router.get('/work-orders/:woId/inventory-check', checkInventoryStatus);
router.post('/work-orders/:woId/approve', approveWorkOrder);
router.post('/work-orders/:woId/reject', rejectWorkOrder);
router.post('/work-orders/:woId/complete', completeWorkOrder);

// Stats
router.get('/stats', getProductionStats);

export default router;
