import express from 'express';
import * as accountsLedgerController from '../controllers/accountsLedgerController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Basic CRUD operations
router.get('/', protect, accountsLedgerController.getAllAccountsLedgers);
router.get('/:id', protect, accountsLedgerController.getAccountsLedgerById);
router.put('/:id', protect, accountsLedgerController.updateAccountsLedger);

// Corporate client integration
router.get('/corporate/:corporateId', protect, accountsLedgerController.getAccountsLedgerByCorporateId);

// Balance operations
router.post('/:id/balance', protect, accountsLedgerController.updateLedgerBalance);

// Tally sync operations
router.get('/sync/pending', protect, accountsLedgerController.getPendingTallySync);
router.post('/:id/sync', protect, accountsLedgerController.syncLedgerWithTally);

// Query operations
router.get('/type/:type', protect, accountsLedgerController.getLedgersByType);

export default router;