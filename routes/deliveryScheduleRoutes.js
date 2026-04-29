import express from 'express';
import * as deliveryScheduleController from '../controllers/deliveryScheduleController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', protect, deliveryScheduleController.createDeliverySchedule);
router.get('/', protect, deliveryScheduleController.getAllDeliverySchedules);
router.get('/:id', protect, deliveryScheduleController.getDeliveryScheduleById);
router.put('/:id', protect, deliveryScheduleController.updateDeliverySchedule);
router.delete('/:id', protect, deliveryScheduleController.deleteDeliverySchedule);

export default router;
