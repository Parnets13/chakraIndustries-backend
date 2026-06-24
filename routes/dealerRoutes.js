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
  getDealerOrderById,
  getDealerOrders,
  repeatDealerOrder,
  trackDealerOrder,
  deleteDealerOrder,
} from '../controllers/dealerOrderController.js';
import {
  checkDealerAvailability,
  getDealerInventory,
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
router.post('/orders/:id/cancel', protectDealer, cancelDealerOrder);
router.get('/orders/:id/track', protectDealer, trackDealerOrder);
router.post('/orders/:id/repeat', protectDealer, repeatDealerOrder);
router.get('/orders/:id', protectDealer, getDealerOrderById);
router.delete('/orders/:id', protectDealer, deleteDealerOrder);

// New warehouse-focused inventory APIs
router.get('/inventory/warehouses', protectDealer, getDealerWarehouses);
router.get('/inventory/warehouse/:warehouseId/items', protectDealer, getDealerWarehouseItems);

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

// Reports Routes
// router.use('/reports', protectDealer, reportRoutes);

// Cart Routes
// router.use('/cart', protectDealer, cartRoutes);

// ERP web can fetch app-registered dealers from same database
router.get('/erp/dealers', protect, getAllDealers);

export default router;
