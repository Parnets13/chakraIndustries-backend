import express from 'express';
import * as materialReturnController from '../controllers/materialReturnController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

// 1. Static Warehouse Routes (Must be at top)
router.get('/warehouse/queue', materialReturnController.getWarehouseQueue);
router.get('/warehouse/returns', materialReturnController.getWarehouseReturns);

// 2. Dashboard & Stats
router.get('/dashboard', materialReturnController.getStats);
router.get('/stats', materialReturnController.getStats);

// 3. Return Lifecycle
router.get('/', materialReturnController.getAll);
router.post('/create', materialReturnController.create);
router.get('/context/:invoiceNo', materialReturnController.getInvoiceContext);
router.get('/:id', materialReturnController.getById);

// 4. Workflow Actions (Specific)
router.put('/:id/approve', materialReturnController.approveReturn);
router.post('/:id/docket', materialReturnController.generateDocket);
router.post('/:id/gate-entry', materialReturnController.createGateEntry);
router.post('/:id/receive', materialReturnController.receiveMaterial);
router.post('/:id/qc-verify', materialReturnController.qcVerification);
router.post('/:id/inventory-update', materialReturnController.inventoryUpdate);
router.post('/:id/finance-close', materialReturnController.financeClosure);

// 5. Generic Stage/Status Updates (Support for multiple endpoints)
router.put('/:id/status', materialReturnController.updateStage);
router.patch('/:id/status', materialReturnController.updateStage);
router.put('/:id/stage', materialReturnController.updateStage);
router.patch('/:id/stage', materialReturnController.updateStage);

// 6. Specific Module Processing
router.post('/:id/qc', materialReturnController.processQC);
router.post('/:id/inventory', materialReturnController.processInventory);
router.post('/:id/reconciliation', materialReturnController.processFinance);
router.post('/:id/loss', materialReturnController.processLoss);
router.post('/:id/transport', materialReturnController.updateTransport);

// 7. Warehouse specific dynamic flow
router.patch('/:id/warehouse/receive', materialReturnController.receiveAtWarehouse);
router.patch('/:id/qc/process', materialReturnController.processQC);
router.patch('/:id/tracking', materialReturnController.updateTracking);
router.get('/:id/workflow/status', materialReturnController.getWorkflowStatus);
router.patch('/:id/workflow/process', materialReturnController.processWorkflowStage);

// 8. Utilities
router.post('/', materialReturnController.create);
router.delete('/:id', materialReturnController.remove);

export default router;
