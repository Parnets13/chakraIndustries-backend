import express from 'express';
import * as corporateClientController from '../controllers/corporateClientController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Basic CRUD operations
router.post('/', protect, corporateClientController.createCorporateClient);
router.get('/', protect, corporateClientController.getAllCorporateClients);
router.get('/:id', protect, corporateClientController.getCorporateClientById);
router.put('/:id', protect, corporateClientController.updateCorporateClient);
router.delete('/:id', protect, corporateClientController.deleteCorporateClient);

// Dynamic Data Flow operations
router.post('/:id/sync', protect, corporateClientController.syncClientWithTally);
router.post('/bulk-sync', protect, corporateClientController.bulkSyncClients);
router.get('/:id/integration-status', protect, corporateClientController.getClientIntegrationStatus);

// Query operations
router.get('/tier/:tier', protect, corporateClientController.getClientsByTier);
router.get('/sync/pending', protect, corporateClientController.getPendingTallySync);

export default router;
