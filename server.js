import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import authRoutes from './routes/authRoutes.js';
import vendorRoutes from './routes/vendorRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import purchaseRequisitionRoutes from './routes/purchaseRequisitionRoutes.js';
import purchaseOrderRoutes from './routes/purchaseOrderRoutes.js';
import rfqRoutes from './routes/rfqRoutes.js';
import grnRoutes from './routes/grnRoutes.js';
import departmentRoutes from './routes/departmentRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import warehouseRoutes from './routes/warehouseRoutes.js';
import locationRoutes from './routes/locationRoutes.js';
import stockMovementRoutes from './routes/stockMovementRoutes.js';
import batchRoutes from './routes/batchRoutes.js';
import pickingListRoutes from './routes/pickingListRoutes.js';
import defectiveStockRoutes from './routes/defectiveStockRoutes.js';
import creditNoteRoutes from './routes/creditNoteRoutes.js';
import clientRoutes from './routes/clientRoutes.js';
import corporateClientRoutes from './routes/corporateClientRoutes.js';
import bulkQuotationRoutes from './routes/bulkQuotationRoutes.js';
import deliveryScheduleRoutes from './routes/deliveryScheduleRoutes.js';
import inventoryDataRoutes from './routes/inventoryDataRoutes.js';
import qualityCheckRoutes from './routes/qualityCheckRoutes.js';

dotenv.config();

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    /\.netlify\.app$/,
    /\.netlify\.com$/,
  ],
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/purchase-requisitions', purchaseRequisitionRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/rfqs', rfqRoutes);
app.use('/api/grn', grnRoutes);
app.use('/api/grns', grnRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/stock-movements', stockMovementRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/picking-lists', pickingListRoutes);
app.use('/api/defective-stock', defectiveStockRoutes);
app.use('/api/credit-notes', creditNoteRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/corporate-clients', corporateClientRoutes);
app.use('/api/bulk-quotations', bulkQuotationRoutes);
app.use('/api/delivery-schedules', deliveryScheduleRoutes);
app.use('/api/inventory-data', inventoryDataRoutes);
app.use('/api/quality-checks', qualityCheckRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
