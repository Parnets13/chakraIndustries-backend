import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getDealerOrders,
  getDealerOrderById,
  approveOrder,
  rejectOrder,
  updatePickingList,
  updateSortingJob,
  updatePackingJob,
  generateInvoice,
  updateDispatch,
  markDelivered,
  getDashboardStats
} from '../controllers/erpDealerOrderController.js';
import PickingList from '../models/PickingList.js';
import SortingJob from '../models/SortingJob.js';
import PackingJob from '../models/PackingJob.js';

const router = express.Router();

// Dashboard stats
router.get('/dashboard', protect, getDashboardStats);

// ── Dealer App orders feed (for ERP Order Management panel) ──────────────────
// GET /api/erp/dealer-orders/dealer?status=&search=&page=&limit=
// Returns only source=DealerApp orders with dealer info + invoice status
router.get('/dealer', protect, (req, res) => {
  req.query.source = 'DealerApp';
  return getDealerOrders(req, res);
});

// All dealer orders (ERP full view)
router.get('/', protect, getDealerOrders);
router.get('/:id', protect, getDealerOrderById);
router.post('/:id/approve', protect, approveOrder);
router.post('/:id/reject', protect, rejectOrder);

// Picking
router.get('/:orderId/picking', protect, async (req, res) => {
  try {
    const { orderId } = req.params;
    const pickingList = await PickingList.findOne({ orderId }).populate('salesOrderId').populate('picker');
    res.status(200).json({ success: true, data: pickingList });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router.put('/picking/:id', protect, updatePickingList);

// Sorting
router.get('/:orderId/sorting', protect, async (req, res) => {
  try {
    const { orderId } = req.params;
    const sortingJobs = await SortingJob.find({ orderId }).populate('salesOrderId');
    res.status(200).json({ success: true, data: sortingJobs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router.put('/sorting/:id', protect, updateSortingJob);

// Packing
router.get('/:orderId/packing', protect, async (req, res) => {
  try {
    const { orderId } = req.params;
    const packingJob = await PackingJob.findOne({ orderId }).populate('salesOrderId');
    res.status(200).json({ success: true, data: packingJob });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router.put('/packing/:id', protect, updatePackingJob);

// Invoice
router.post('/:orderId/invoice', protect, generateInvoice);

// Dispatch
router.put('/:orderId/dispatch', protect, updateDispatch);
router.post('/:orderId/deliver', protect, markDelivered);

export default router;