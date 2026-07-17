import express from 'express';
import {
  getAllDealers,
  getDealerDashboard,
  getDealerMe,
  getDealerProfile,
  logoutDealer,
  registerDealer,
  sendDealerOtp,
  updateDealerProfile,
  verifyDealerOtp,
} from '../controllers/dealerController.js';
import {
  getDealerCategoryById,
  getDealerProductById,
  getDealerProductCategories,
  getDealerProducts,
  getDealerProductsByCategoryId,
  searchDealerProducts,
} from '../controllers/dealerProductController.js';
import {
  cancelDealerOrder,
  createDealerOrder,
  createDealerOrderForm,
  getDealerOrderById,
  getDealerOrders,
  placeDealerOrder,
  repeatDealerOrder,
  trackDealerOrder,
  updateDealerOrder,
  deleteDealerOrder,
} from '../controllers/dealerOrderController.js';
import {
  checkDealerAvailability,
  getDealerInventory,
  getDealerInventoryStock,
  getDealerPincodeStock,
  getDealerProductInventory,
  getDealerWarehouses,
  getDealerWarehouseItems,
} from '../controllers/dealerInventoryController.js';
import {
  getDealerApprovedQuotations,
  getDealerQuotationRequests,
  requestDealerQuotation,
} from '../controllers/dealerQuotationController.js';
import { protectDealer } from '../middleware/dealerAuthMiddleware.js';
import { protect } from '../middleware/authMiddleware.js';
import dispatchRoutes from './dealer/dispatchRoutes.js';
import returnRoutes from './dealer/returnRoutes.js';
import invoiceRoutes from './dealer/invoiceRoutes.js';
// import reportRoutes from './dealer/reportRoutes.js';
// import cartRoutes from './dealer/cartRoutes.js';

const router = express.Router();

// Mobile dealer auth
router.post('/auth/register', registerDealer);
router.post('/auth/send-otp', sendDealerOtp);
router.post('/auth/verify-otp', verifyDealerOtp);
router.post('/auth/logout', protectDealer, logoutDealer);
router.get('/auth/me', protectDealer, getDealerMe);

// Mobile dealer profile/dashboard
router.get('/profile/dashboard', protectDealer, getDealerDashboard);
router.get('/profile', protectDealer, getDealerProfile);
router.put('/profile/update', protectDealer, updateDealerProfile);

router.get('/orders', protectDealer, getDealerOrders);
router.post('/orders/create', protectDealer, createDealerOrder);
router.post('/orders/create-form', protectDealer, createDealerOrderForm);
router.post('/orders/:id/cancel', protectDealer, cancelDealerOrder);
router.post('/orders/:id/place', protectDealer, placeDealerOrder);
router.get('/orders/:id/track', protectDealer, trackDealerOrder);
router.post('/orders/:id/repeat', protectDealer, repeatDealerOrder);
router.put('/orders/:id', protectDealer, updateDealerOrder);
router.get('/orders/:id', protectDealer, getDealerOrderById);
router.delete('/orders/:id', protectDealer, deleteDealerOrder);

// New warehouse-focused inventory APIs
router.get('/inventory/warehouses', protectDealer, getDealerWarehouses);
router.get('/inventory/warehouse/:warehouseId/items', protectDealer, getDealerWarehouseItems);

// Inventory stock — full data for InventoryPage (must be before /:id style routes)
router.get('/inventory/stock', protectDealer, getDealerInventoryStock);
router.get('/inventory/stock-items', protectDealer, getDealerInventoryStock);

// Existing inventory APIs (kept for backward compatibility)
router.get('/inventory', protectDealer, getDealerInventory);
router.get('/inventory/product/:productId', protectDealer, getDealerProductInventory);
router.post('/inventory/check', protectDealer, checkDealerAvailability);
router.get('/inventory/pincode', protectDealer, getDealerPincodeStock);

router.post('/quotations/request', protectDealer, requestDealerQuotation);
router.get('/quotations/requests', protectDealer, getDealerQuotationRequests);
router.get('/quotations/approved', protectDealer, getDealerApprovedQuotations);

router.get('/products/search', protectDealer, searchDealerProducts);
router.get('/products/categories', protectDealer, getDealerProductCategories);
router.get('/products/category/:id', protectDealer, getDealerProductsByCategoryId);
router.get('/products/:id', protectDealer, getDealerProductById);
router.get('/products', protectDealer, getDealerProducts);
router.get('/categories/:id', protectDealer, getDealerCategoryById);

// Dispatch & Tracking Routes
router.use('/dispatch', protectDealer, dispatchRoutes);

// Returns Routes
router.use('/returns', protectDealer, returnRoutes);

// Invoices Routes
router.use('/invoices', protectDealer, invoiceRoutes);

// Finance summary for dealer app
router.get('/finance/summary', protectDealer, async (req, res) => {
  try {
    const Invoice = (await import('../models/Invoice.js')).default;
    const CreditNote = (await import('../models/CreditNote.js')).default;
    const dealer = req.dealer;

    // Match invoices by dealerId OR partyName OR businessName
    const matchOr = [{ dealerId: dealer._id }];
    if (dealer.businessName) matchOr.push({ partyName: { $regex: dealer.businessName, $options: 'i' } });
    if (dealer.name)         matchOr.push({ partyName: { $regex: dealer.name, $options: 'i' } });

    const invoices = await Invoice.find({ $or: matchOr }).lean();

    let totalOutstanding = 0;
    let totalPurchases   = 0;
    let nextDueDate      = null;
    let nextDueAmount    = 0;
    const today          = new Date();
    today.setHours(0, 0, 0, 0);

    invoices.forEach(inv => {
      const grand     = inv.grandTotal     || 0;
      const paid      = inv.paidAmount     || 0;
      const remaining = inv.remainingAmount != null
        ? inv.remainingAmount
        : Math.max(0, grand - paid);

      totalPurchases += grand;

      if (inv.paymentStatus !== 'Paid') {
        totalOutstanding += remaining;
        if (inv.dueDate) {
          const due = new Date(inv.dueDate);
          if (!nextDueDate || due < nextDueDate) {
            nextDueDate  = due;
            nextDueAmount = remaining;
          }
        }
      }
    });

    // Use dealer's stored outstandingAmount as fallback if invoices give 0
    if (totalOutstanding === 0 && dealer.outstandingAmount > 0) {
      totalOutstanding = dealer.outstandingAmount;
    }

    // Credit notes for this dealer
    let creditNotesAmount = 0;
    try {
      const creditNotes = await CreditNote.find({
        $or: [
          { dealerId: dealer._id },
          ...(dealer.businessName ? [{ partyName: { $regex: dealer.businessName, $options: 'i' } }] : []),
        ],
        status: { $in: ['Approved', 'Issued', 'Active'] },
      }).lean();
      creditNotesAmount = creditNotes.reduce((s, cn) => s + (cn.amount || cn.totalAmount || 0), 0);
    } catch (_) { /* credit notes are optional */ }

    const daysLeft = nextDueDate
      ? Math.ceil((nextDueDate - today) / (1000 * 60 * 60 * 24))
      : null;

    const progressPct = totalPurchases > 0
      ? Math.min(100, Math.round((totalOutstanding / totalPurchases) * 100))
      : 0;

    console.log(`[finance/summary] dealer=${dealer.businessName || dealer.name}, invoices=${invoices.length}, outstanding=${totalOutstanding}, purchases=${totalPurchases}`);

    res.json({
      success: true,
      data: {
        outstanding:    totalOutstanding,
        totalPurchases,
        creditNotes:    creditNotesAmount,
        nextDueDate:    nextDueDate
          ? nextDueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          : null,
        nextDueAmount,
        daysLeft,
        progressPct,
        totalInvoices:  invoices.length,
        paidInvoices:   invoices.filter(i => i.paymentStatus === 'Paid').length,
        pendingInvoices: invoices.filter(i => i.paymentStatus !== 'Paid').length,
      },
    });
  } catch (err) {
    console.error('finance/summary error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Reports Routes
// router.use('/reports', protectDealer, reportRoutes);

// Cart Routes
// router.use('/cart', protectDealer, cartRoutes);

// ERP web can fetch app-registered dealers from same database
router.get('/erp/dealers', protect, getAllDealers);

export default router;
