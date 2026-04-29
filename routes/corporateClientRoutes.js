import express from 'express';
import * as corporateClientController from '../controllers/corporateClientController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', protect, corporateClientController.createCorporateClient);
router.get('/', protect, corporateClientController.getAllCorporateClients);
router.get('/:id', protect, corporateClientController.getCorporateClientById);
router.put('/:id', protect, corporateClientController.updateCorporateClient);
router.delete('/:id', protect, corporateClientController.deleteCorporateClient);

export default router;
