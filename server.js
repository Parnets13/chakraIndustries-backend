import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import authRoutes from './routes/authRoutes.js';
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

// Ensure new models are registered
import './models/Warehouse.js';
import './models/StockMovement.js';

dotenv.config();

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    const allowed = [
      'http://localhost:5173',
      'http://localhost:3000',
    ];
    const allowedPatterns = [
      /\.netlify\.app$/,
      /\.netlify\.com$/,
      /\.onrender\.com$/,
    ];
    if (allowed.includes(origin) || allowedPatterns.some(p => p.test(origin))) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
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
