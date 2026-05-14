import express from 'express';
import * as dispatchClientController from '../controllers/dispatchClientController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Basic CRUD operations
router.get('/', protect, dispatchClientController.getAllDispatchClients);
router.get('/:id', protect, dispatchClientController.getDispatchClientById);
router.put('/:id', protect, dispatchClientController.updateDispatchClient);

// Corporate client integration
router.get('/corporate/:corporateId', protect, dispatchClientController.getDispatchClientByCorporateId);

// Delivery operations
router.post('/:id/delivery-stats', protect, dispatchClientController.updateDeliveryStats);
router.get('/stats/delivery', protect, dispatchClientController.getDeliveryStats);

// Location-based queries
router.get('/city/:city', protect, dispatchClientController.getClientsByCity);
router.get('/pincode/:pincode', protect, dispatchClientController.getClientsByPincode);

export default router;