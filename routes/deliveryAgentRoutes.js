import express from 'express';
import {
  loginDeliveryAgent,
  sendDeliveryOtp,
  verifyDeliveryOtp,
  getDeliveryProfile,
} from '../controllers/deliveryAgentController.js';

const router = express.Router();

router.post('/login', loginDeliveryAgent);
router.post('/send-otp', sendDeliveryOtp);
router.post('/verify-otp', verifyDeliveryOtp);
router.get('/profile', getDeliveryProfile);

export default router;
