import express from 'express';
import * as accountsLedgerController from '../controllers/accountsLedgerController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Pattern-based routes (must come before /:id routes)
router.get('/sync/pending', protect, accountsLedgerController.getPendingTallySync);
router.post('/balance/recalculate', protect, accountsLedgerController.recalculateClosingBalances);
router.get('/reports/trial-balance', protect, accountsLedgerController.getTrialBalance);
router.get('/type/:type', protect, accountsLedgerController.getLedgersByType);

// Specific ID-based routes (come after pattern routes)
router.get('/', protect, accountsLedgerController.getAllAccountsLedgers);
router.get('/:id/balance-summary', protect, accountsLedgerController.getBalanceSummary);
router.get('/:id/transactions', protect, accountsLedgerController.getLedgerTransactions);
router.get('/:id', protect, accountsLedgerController.getAccountsLedgerById);
router.put('/:id', protect, accountsLedgerController.updateAccountsLedger);

// Corporate client integration
router.get('/corporate/:corporateId', protect, accountsLedgerController.getAccountsLedgerByCorporateId);

// Balance operations
router.post('/:id/balance', protect, accountsLedgerController.updateLedgerBalance);
router.post('/:id/balance/calculate-closing', protect, accountsLedgerController.calculateClosingBalance);

// Tally sync operations
router.post('/:id/sync', protect, accountsLedgerController.syncLedgerWithTally);

export default router;