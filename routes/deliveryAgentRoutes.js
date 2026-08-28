import express from 'express';
import {
  loginDeliveryAgent,
  sendDeliveryOtp,
  verifyDeliveryOtp,
  getDeliveryProfile,
} from '../controllers/deliveryAgentController.js';
import {
  getReturnReasons,
  searchDockets,
  getReturnableItems,
  createMaterialReturn,
  listMaterialReturns,
  getDashboardStats,
  getMaterialReturnGroup,
  getDocketReturnHistory,
} from '../controllers/deliveryMaterialReturnController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/login', loginDeliveryAgent);
router.post('/send-otp', sendDeliveryOtp);
router.post('/verify-otp', verifyDeliveryOtp);
router.get('/profile', getDeliveryProfile);

// ── Material Returns – Docket Identification & Returns Management ─────────────
// All routes protected — requires a valid logged-in user (delivery_logistics).
router.get('/material-returns/reasons', protect, getReturnReasons);
router.get('/material-returns/dashboard', protect, getDashboardStats);
router.get('/material-returns/search-dockets', protect, searchDockets);
router.get('/material-returns/docket/:scheduleId/returnable', protect, getReturnableItems);
router.get('/material-returns/docket/:scheduleId/history', protect, getDocketReturnHistory);
router.get('/material-returns/group/:groupId', protect, getMaterialReturnGroup);
router.get('/material-returns', protect, listMaterialReturns);
router.post('/material-returns', protect, createMaterialReturn);

export default router;
