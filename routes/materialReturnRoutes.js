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
import MaterialReturn     from '../models/MaterialReturn.js';
import DealerNotification from '../models/DealerNotification.js';

const router = express.Router();
router.use(protect);

router.get('/stats', getStats);
router.get('/invoice/:invoiceNo/context', getInvoiceContext);
router.get('/', getAll);
router.post('/', create);
router.put('/:id/approve', approveReturn);

/* ── PATCH /:id/dealer-approve — Admin approves a dealer return request ───── */
router.patch('/:id/dealer-approve', async (req, res) => {
  try {
    const mr = await MaterialReturn.findById(req.params.id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    mr.approvalStatus = 'Approved';
    mr.approvedBy     = req.user?.name || 'Admin';
    mr.currentStage   = 'APPROVED';
    mr.stageTimeline.push({
      stage:   'APPROVED',
      user:    req.user?.name || 'Admin',
      remarks: req.body.remarks || 'Return request approved by admin.',
      status:  'Completed',
      timestamp: new Date(),
    });
    await mr.save();

    // Push in-app notification to dealer
    if (mr.dealerId) {
      await DealerNotification.create({
        dealerId: mr.dealerId,
        type:     'return_approved',
        title:    'Return Request Approved ✅',
        message:  `Your return request for "${mr.productName}" has been approved successfully.`,
        refId:    mr.mrId,
        refModel: 'MaterialReturn',
      });
    }

    res.json({ success: true, message: 'Return approved', data: mr });
  } catch (err) {
    console.error('[dealer-approve]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── PATCH /:id/dealer-reject — Admin rejects a dealer return request ─────── */
router.patch('/:id/dealer-reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const mr = await MaterialReturn.findById(req.params.id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    mr.approvalStatus = 'Rejected';
    mr.currentStage   = 'REQUEST_RAISED'; // stays at request stage, just flagged rejected
    mr.remarks        = reason || mr.remarks;
    mr.stageTimeline.push({
      stage:   'REQUEST_RAISED',
      user:    req.user?.name || 'Admin',
      remarks: `Rejected: ${reason || 'No reason provided'}`,
      status:  'Completed',
      timestamp: new Date(),
    });
    await mr.save();

    // Push in-app notification to dealer
    if (mr.dealerId) {
      await DealerNotification.create({
        dealerId: mr.dealerId,
        type:     'return_rejected',
        title:    'Return Request Rejected ❌',
        message:  `Your return request for "${mr.productName}" has been rejected. Please contact the administrator for more information.`,
        refId:    mr.mrId,
        refModel: 'MaterialReturn',
      });
    }

    res.json({ success: true, message: 'Return rejected', data: mr });
  } catch (err) {
    console.error('[dealer-reject]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});
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
