import express from 'express';
import http from 'http';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import connectDB from './config/database.js';
import authRoutes from './routes/authRoutes.js';
import dealerRoutes from './routes/dealerRoutes.js';
import erpDealerOrdersRoutes from './routes/erpDealerOrders.js';
import userRoutes from './routes/userRoutes.js';
import permissionRoutes from './routes/permissionRoutes.js';
import activityLogRoutes from './routes/activityLogRoutes.js';
import vendorRoutes from './routes/vendorRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import purchaseRequisitionRoutes from './routes/purchaseRequisitionRoutes.js';
import purchaseOrderRoutes from './routes/purchaseOrderRoutes.js';
import rfqRoutes from './routes/rfqRoutes.js';
import grnRoutes from './routes/grnRoutes.js';
import departmentRoutes from './routes/departmentRoutes.js';
import qualityCheckRoutes from './routes/qualityCheckRoutes.js';
import approvalRoutes from './routes/approvalRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import materialReturnRoutes from './routes/materialReturnRoutes.js';
import creditNoteRoutes from './routes/creditNoteRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import logisticsRoutes from './routes/logisticsRoutes.js';
import bulkOrderRoutes from './routes/bulkOrderRoutes.js';
import inventoryDataRoutes from './routes/inventoryDataRoutes.js';
import pickingListRoutes from './routes/pickingListRoutes.js';
import sortingJobRoutes from './routes/sortingJobRoutes.js';
import packingJobRoutes from './routes/packingJobRoutes.js';
import batchRoutes from './routes/batchRoutes.js';
import defectiveStockRoutes from './routes/defectiveStockRoutes.js';
import clientRoutes from './routes/clientRoutes.js';
import bomRoutes from './routes/bomRoutes.js';
import workOrderRoutes from './routes/workOrderRoutes.js';
import oemRoutes from './routes/oemRoutes.js';
import oemOrderRoutes from './routes/oemOrderRoutes.js';
import oemInvoiceRoutes from './routes/oemInvoiceRoutes.js';
import oemFinishedGoodsRoutes from './routes/oemFinishedGoodsRoutes.js';
import mrpRoutes from './routes/mrpRoutes.js';
import assetRoutes from './routes/assetRoutes.js';
import warehouseRoutes from './routes/warehouseRoutes.js';
import stockMovementRoutes from './routes/stockMovementRoutes.js';
import itemMasterRoutes from './routes/itemMasterRoutes.js';
import locationRoutes from './routes/locationRoutes.js';
import deliveryScheduleRoutes from './routes/deliveryScheduleRoutes.js';
import corporateClientRoutes from './routes/corporateClientRoutes.js';
import quotationClientRoutes from './routes/quotationClientRoutes.js';
import invoiceClientRoutes from './routes/invoiceClientRoutes.js';
import accountsLedgerRoutes from './routes/accountsLedgerRoutes.js';
import dispatchClientRoutes from './routes/dispatchClientRoutes.js';
import bulkQuotationRoutes from './routes/bulkQuotationRoutes.js';
import bulkQuotationRequestRoutes from './routes/bulkQuotationRequestRoutes.js';
import bulkOrderApprovalRoutes from './routes/bulkOrderApprovalRoutes.js';
import packagingRoutes from './routes/packagingRoutes.js';
import brandOrderRoutes from './routes/brandOrderRoutes.js';
import oemOrderEnhancedRoutes from './routes/oemOrderEnhancedRoutes.js';
import bulkOrderInventoryRoutes from './routes/bulkOrderInventoryRoutes.js';
import bulkOrderInvoiceRoutes from './routes/bulkOrderInvoiceRoutes.js';
import bulkOrderCreditRoutes from './routes/bulkOrderCreditRoutes.js';
import salesOrderRoutes from './routes/salesOrderRoutes.js';
import tallyRoutes from './routes/tallyRoutes.js';
import { startTallyScheduler } from './services/tallyScheduler.js';
import { rawXmlParser } from './controllers/tallyWebhookController.js';
import reportsRoutes from './routes/reportsRoutes.js';
import forecastingRoutes from './routes/forecastingRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import returnsRoutes from './routes/returnsRoutes.js';
import reconciliationRoutes from './routes/reconciliationRoutes.js';
import debitNoteRoutes from './routes/debitNoteRoutes.js';
import docketTrackingRoutes from './routes/docketTrackingRoutes.js';
import lossTrackingRoutes from './routes/lossTrackingRoutes.js';
import poGeneratorRoutes from './routes/poGeneratorRoutes.js';
import brsRoutes from './routes/brsRoutes.js';
import financeRoutes from './routes/financeRoutes.js';
import productionRoutes from './routes/productionRoutes.js';
import { initConnectorServer, getConnectorStatuses } from './services/tallyConnectorServer.js';

// Ensure new models are registered
import './models/Warehouse.js';
import './models/StockMovement.js';
import './models/SalesOrder.js';
import './models/TallyConfig.js';
import './models/TallySyncLog.js';
import './models/TallySyncState.js';
import './models/OEMBrand.js';
import './models/OEMProduct.js';
import './models/OEMOrder.js';
import './models/OEMInvoice.js';
import './models/OEMFinishedGoods.js';
import './models/Packaging.js';
import './models/BulkOrder.js';
import './models/BulkOrderApproval.js';
import './models/BulkQuotation.js';
import './models/BulkQuotationRequest.js';
import './models/CorporateClient.js';
import './models/QuotationClient.js';
import './models/InvoiceClient.js';
import './models/AccountsLedger.js';
import './models/DispatchClient.js';
import './models/LossTracking.js';
import './models/POInvoice.js';
import './models/PendingOrder.js';
import './models/DebitNote.js';
import './models/TallyVoucher.js';
import './models/BankReconciliation.js';
import './models/ActivityLog.js';
import './models/Approval.js';
import './models/Asset.js';
import './models/BOM.js';
import './models/Company.js';
import './models/Batch.js';
import './models/BrandOrder.js';
import './models/Category.js';
import './models/Client.js';
import './models/CreditNote.js';
import './models/Dealer.js';
import './models/DefectLog.js';
import './models/DefectiveStock.js';
import './models/DeliverySchedule.js';
import './models/Department.js';
import './models/DismissedNotification.js';
import './models/DocketTracking.js';
import './models/GRN.js';
import './models/Inventory.js';
import './models/InventoryItem.js';
import './models/InventoryLog.js';
import './models/Invoice.js';
import './models/ItemMaster.js';
import './models/Location.js';
import './models/Logistics.js';
import './models/MRPRun.js';
import './models/MaterialReturn.js';
import './models/PackingJob.js';
import './models/Permission.js';
import './models/PickingList.js';
import './models/PurchaseOrder.js';
import './models/PurchaseRequisition.js';
import './models/QualityCheck.js';
import './models/QuotationRequestItem.js';
import './models/RFQ.js';
import './models/ReturnQC.js';
import './models/SortingJob.js';
import './models/Task.js';
import './models/User.js';
import './models/Vendor.js';
import './models/VendorPrice.js';
import './models/WarehouseGateEntry.js';
import './models/WarehouseVerification.js';
import './models/WorkOrder.js';

dotenv.config();

// Server configuration
const app = express();

// Rate limiting middleware — relaxed for local dev, tighter for production
const limiter = rateLimit({
  windowMs: 1000, // 1 second
  max: process.env.NODE_ENV === 'production' ? 10 : 200, // 200/sec locally, 10/sec in prod
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for localhost in development
    const ip = req.ip || req.connection?.remoteAddress || '';
    return process.env.NODE_ENV !== 'production' && (ip === '::1' || ip === '127.0.0.1' || ip.includes('::ffff:127.0.0.1'));
  },
});

// Middleware
app.use(limiter);
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    const allowed = [
      'http://localhost:5001/api/api',
      'https://erp.majesticmall.net',
      'https://majesticmall.net',
      'http://localhost:3000',
      'http://localhost:5001',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:4173',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:3000',
    ];
    const allowedPatterns = [
      /\.netlify\.app$/,
      /\.netlify\.com$/,
      /\.onrender\.com$/,
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/127\.0\.0\.1:\d+$/,
    ];
    if (allowed.includes(origin) || allowedPatterns.some(p => p.test(origin))) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Raw XML parser for Tally webhook (must be before JSON routes)
app.use('/api/tally/webhook', rawXmlParser);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dealer', dealerRoutes);
app.use('/api/erp/dealer-orders', erpDealerOrdersRoutes);
app.use('/api/users', userRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/activity-logs', activityLogRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/purchase-requisitions', purchaseRequisitionRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/rfqs', rfqRoutes);
app.use('/api/grns', grnRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/quality-checks', qualityCheckRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/material-returns', materialReturnRoutes);
app.use('/api/credit-notes', creditNoteRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/logistics', logisticsRoutes);
app.use('/api/bulk-orders', bulkOrderRoutes);
app.use('/api/bulk-order-approvals', bulkOrderApprovalRoutes);
app.use('/api/packaging', packagingRoutes);
app.use('/api/brand-orders', brandOrderRoutes);
app.use('/api/oem-orders-enhanced', oemOrderEnhancedRoutes);
app.use('/api/inventory-data', inventoryDataRoutes);
app.use('/api/picking', pickingListRoutes);
app.use('/api/sorting', sortingJobRoutes);
app.use('/api/packing', packingJobRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/defective-stock', defectiveStockRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/bom', bomRoutes);
app.use('/api/workorders', workOrderRoutes);
app.use('/api/oem', oemRoutes);
app.use('/api/oem-orders', oemOrderRoutes);
app.use('/api/oem-invoices', oemInvoiceRoutes);
app.use('/api/oem-finished-goods', oemFinishedGoodsRoutes);
app.use('/api/mrp', mrpRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/stock-movements', stockMovementRoutes);
app.use('/api/item-master', itemMasterRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/delivery-schedules', deliveryScheduleRoutes);
app.use('/api/corporate-clients', corporateClientRoutes);
app.use('/api/quotation-clients', quotationClientRoutes);
app.use('/api/invoice-clients', invoiceClientRoutes);
app.use('/api/accounts-ledgers', accountsLedgerRoutes);
app.use('/api/dispatch-clients', dispatchClientRoutes);
app.use('/api/bulk-quotations', bulkQuotationRoutes);
app.use('/api/bulk-quotation-requests', bulkQuotationRequestRoutes);
app.use('/api/bulk-order-inventory', bulkOrderInventoryRoutes);
app.use('/api/bulk-order-invoices', bulkOrderInvoiceRoutes);
app.use('/api/bulk-order-credit', bulkOrderCreditRoutes);
app.use('/api/sales-orders', salesOrderRoutes);
app.use('/api/tally', tallyRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/forecasting', forecastingRoutes);
app.use('/api/invoices',     invoiceRoutes);
app.use('/api/returns',        returnsRoutes);
app.use('/api/reconciliation', reconciliationRoutes);
app.use('/api/debit-notes',    debitNoteRoutes);
app.use('/api/docket-tracking', docketTrackingRoutes);
app.use('/api/loss-tracking', lossTrackingRoutes);
app.use('/api/po-generator', poGeneratorRoutes);
app.use('/api/brs', brsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/production-entries', productionRoutes);

// Health check
// eslint-disable-next-line no-unused-vars
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Error handling middleware
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 5001;

// Start server immediately, connect to MongoDB in background
connectDB();

// Create HTTP server and attach Socket.IO
const httpServer = http.createServer(app);
initConnectorServer(httpServer);

httpServer.listen(PORT, async () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Connector Socket.IO server ready`);
  startTallyScheduler();

  // ── SMTP startup verification ────────────────────────────────────────────
  try {
    const { verifyTransporter } = await import('./utils/emailService.js');
    await verifyTransporter();
    const emailUser = (process.env.EMAIL_USERNAME || process.env.SMTP_USER || '').trim();
    console.log(`✓ SMTP connected — authenticated as ${emailUser}`);
  } catch (err) {
    console.warn(`⚠ SMTP verification failed at startup: ${err.message}`);
    console.warn('  Email sending will not work until EMAIL_USERNAME / EMAIL_PASSWORD are correct in .env');
  }
  // ────────────────────────────────────────────────────────────────────────
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`✗ Port ${PORT} is already in use. Stop the other process and restart.`);
    process.exit(1);
  } else {
    throw err;
  }
});
