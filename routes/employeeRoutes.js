import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  registerEmployee,
  loginEmployee,
  getEmployeeMe,
  updateEmployeeProfile,
  logoutEmployee,
  getAllRegisteredEmployees,
  adminUpdateEmployee,
  adminDeleteEmployee,
  upload as profileUpload,
} from '../Employeemanage/employeeController.js';
import {
  getMyProducts,
  getMyProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProductAdmin,
  getAllProductsAdmin,
  getProductByIdAdmin,
  updateProductStatusAdmin,
} from '../Employeemanage/employeeproductController.js';
import { protectEmployee } from '../middleware/employeeAuthMiddleware.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Multer for employee product images ───────────────────────────────────────
const productStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/employee-products');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const productUpload = multer({
  storage: productStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const extOk = !ext || /\.(jpe?g|png|gif|webp)$/i.test(ext);
    const mimeOk = !file.mimetype || /image|octet-stream/.test(file.mimetype);
    cb(null, extOk || mimeOk);
  },
});

const router = express.Router();

const handleUpload = (middleware) => (req, res, next) => {
  middleware(req, res, (err) => {
    if (err) {
      console.error('❌ Multer upload error:', err.message);
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload failed',
      });
    }
    next();
  });
};

/** JSON body registration (no photo) */
const registerJson = (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) {
    return registerEmployee(req, res);
  }
  next();
};

/** Multipart registration with optional profile photo */
const registerMultipart = handleUpload(profileUpload.single('profilePhoto'));

// ── Auth routes ───────────────────────────────────────────────────────────────
router.post('/register', registerJson, registerMultipart, registerEmployee);
router.post('/login', loginEmployee);

// ── Employee profile routes ───────────────────────────────────────────────────
router.get('/me', protectEmployee, getEmployeeMe);
router.put('/profile', protectEmployee, handleUpload(profileUpload.single('profilePhoto')), updateEmployeeProfile);
router.post('/logout', protectEmployee, logoutEmployee);

// ── Employee product routes ───────────────────────────────────────────────────
router.get('/products',          protectEmployee, getMyProducts);
router.get('/products/:id',      protectEmployee, getMyProductById);
router.post('/products',         protectEmployee, handleUpload(productUpload.single('productImage')), createProduct);
router.put('/products/:id',      protectEmployee, handleUpload(productUpload.single('productImage')), updateProduct);
router.delete('/products/:id',   protectEmployee, deleteProduct);

// ── Admin product routes ──────────────────────────────────────────────────────
const ADMIN_ROLES = ['super_admin', 'management', 'purchase_manager', 'production_manager'];

// ── Admin: list all registered employees (from mobile app) ───────────────────
router.get(
  '/admin/registered-employees',
  protect,
  authorize(...ADMIN_ROLES),
  getAllRegisteredEmployees,
);

// ── Admin: update employee ────────────────────────────────────────────────────
router.put(
  '/admin/registered-employees/:id',
  protect,
  authorize(...ADMIN_ROLES),
  adminUpdateEmployee,
);

// ── Admin: delete employee ────────────────────────────────────────────────────
router.delete(
  '/admin/registered-employees/:id',
  protect,
  authorize(...ADMIN_ROLES),
  adminDeleteEmployee,
);

router.get(
  '/admin/products',
  protect,
  authorize(...ADMIN_ROLES),
  getAllProductsAdmin,
);
router.get(
  '/admin/products/:id',
  protect,
  authorize(...ADMIN_ROLES),
  getProductByIdAdmin,
);
router.patch(
  '/admin/products/:id/status',
  protect,
  authorize(...ADMIN_ROLES),
  updateProductStatusAdmin,
);
router.delete(
  '/admin/products/:id',
  protect,
  authorize(...ADMIN_ROLES),
  deleteProductAdmin,
);

export default router;
