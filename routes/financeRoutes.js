
import express from 'express';
import * as financeController from '../controllers/financeController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Dashboard
router.get('/dashboard', protect, financeController.getDashboardStats);
router.get('/transactions/recent', protect, financeController.getRecentTransactions);

// Accounts Payable
router.get('/accounts-payable', protect, financeController.getAccountsPayable);
router.post('/accounts-payable', protect, financeController.createAccountsPayable);
router.put('/accounts-payable/:id', protect, financeController.updateAccountsPayable);

// Accounts Receivable
router.get('/accounts-receivable', protect, financeController.getAccountsReceivable);
router.post('/accounts-receivable', protect, financeController.createAccountsReceivable);
router.put('/accounts-receivable/:id', protect, financeController.updateAccountsReceivable);

// Supplier Payments
router.get('/supplier-payments', protect, financeController.getSupplierPayments);
router.post('/supplier-payments', protect, financeController.createSupplierPayment);

// Dealer Receipts
router.get('/dealer-receipts', protect, financeController.getDealerReceipts);
router.post('/dealer-receipts', protect, financeController.createDealerReceipt);

// Supplier Ledger
router.get('/supplier-ledger', protect, financeController.getSupplierLedger);

// Dealer Ledger
router.get('/dealer-ledger', protect, financeController.getDealerLedger);

// Outstanding Invoices
router.get('/outstanding-invoices', protect, financeController.getOutstandingInvoices);

// Bank & Cash Accounts
router.get('/bank-cash-accounts', protect, financeController.getBankCashAccounts);

// Payment History
router.get('/payment-history', protect, financeController.getPaymentHistory);

// Financial Reports
router.get('/reports/:type', protect, financeController.getFinancialReports);

export default router;
