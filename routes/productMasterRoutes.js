import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { protect, authorize } from '../middleware/authMiddleware.js';
import { protectEmployee } from '../middleware/employeeAuthMiddleware.js';
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getFilters,
  generateSku,
} from '../controllers/productMasterController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Multer setup for product images ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/products');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'prod-' + suffix + path.extname(file.originalname || '.jpg'));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extOk  = /\.(jpe?g|png|gif|webp)$/i.test(path.extname(file.originalname || ''));
    const mimeOk = /image|octet-stream/.test(file.mimetype || '');
    cb(null, extOk || mimeOk);
  },
});

const handleUpload = (mw) => (req, res, next) =>
  mw(req, res, err => {
    if (err) return res.status(400).json({ success: false, message: err.message || 'File upload failed' });
    next();
  });

const ADMIN_ROLES = ['super_admin', 'management', 'purchase_manager', 'production_manager'];

const router = express.Router();

// ── Public-ish for employees (read-only) ─────────────────────────────────────
// Both ERP admins AND mobile employees can read products.
// protectEmployee sends a response when it rejects, so we intercept with a
// fake res that captures the rejection without flushing it to the client,
// then fall through to the standard admin protect middleware.
const canRead = (req, res, next) => {
  // Build a lightweight proxy that swallows the response if the employee
  // middleware rejects — we only care whether it called next() without error.
  let employeePassed = false;
  const fakeRes = new Proxy(res, {
    get(target, prop) {
      // Intercept status/json/send so the employee middleware can't commit a
      // response; it thinks it sent one but we discard it.
      if (prop === 'status') return () => fakeRes;
      if (prop === 'json' || prop === 'send') return () => fakeRes;
      if (prop === 'end')    return () => fakeRes;
      return typeof target[prop] === 'function'
        ? target[prop].bind(target)
        : target[prop];
    },
  });

  protectEmployee(req, fakeRes, (err) => {
    if (!err) {
      employeePassed = true;
      return next();
    }
    // Employee auth failed — try admin auth on the real res
    if (!employeePassed) protect(req, res, next);
  });
};

router.get('/',          canRead, getAllProducts);
router.get('/filters',   canRead, getFilters);
router.get('/sku-gen',   protect, authorize(...ADMIN_ROLES), generateSku);
router.get('/:id',       canRead, getProductById);

// ── Admin only (write operations) ────────────────────────────────────────────
router.post('/',    protect, authorize(...ADMIN_ROLES), handleUpload(upload.array('images', 10)), createProduct);
router.put('/:id',  protect, authorize(...ADMIN_ROLES), handleUpload(upload.array('images', 10)), updateProduct);
router.delete('/:id', protect, authorize(...ADMIN_ROLES), deleteProduct);

export default router;
