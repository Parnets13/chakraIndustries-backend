import express from 'express';
import { 
  getAll, 
  getStats, 
  create, 
  updateStage, 
  issueCreditNote, 
  remove,
  getWarehouseQueue,
  warehouseReceive,
  qcReceive,
  updateTransportStatus,
  getWorkflowStatus,
  processWorkflowStage,
  getWarehouseReturns,
  receiveAtWarehouse,
  processQC,
  updateTracking,
  updateTransport,
  getInvoiceContext,
  processFinance,
  approveReturn
} from '../controllers/materialReturnController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.get('/stats', getStats);
router.get('/invoice/:invoiceNo/context', getInvoiceContext);
router.get('/', getAll);
router.post('/', create);
router.put('/:id/approve', approveReturn);
router.patch('/:id/stage', updateStage);
router.patch('/:id/credit-note', issueCreditNote);
router.delete('/:id', remove);

// New warehouse workflow routes
router.get('/warehouse/queue', getWarehouseQueue);
router.patch('/:id/warehouse/receive', receiveAtWarehouse);
router.post('/:id/reconciliation', processFinance);
router.patch('/:id/qc/receive', qcReceive);
router.patch('/:id/transport/status', updateTransportStatus);

// Workflow tracking routes
router.get('/:id/workflow/status', getWorkflowStatus);
router.patch('/:id/workflow/process', processWorkflowStage);

// Warehouse receive routes
router.get('/warehouse/returns', getWarehouseReturns);
router.patch('/:id/warehouse/receive', receiveAtWarehouse);
router.patch('/:id/qc/process', processQC);

// Tracking update route
router.patch('/:id/tracking', updateTracking);
router.post('/:id/transport', updateTransport);
router.put('/:id/status', updateStage);

export default router;
