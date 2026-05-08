import express from 'express';
import {
  getAllBrands, getBrandById, createBrand, updateBrand, deleteBrand,
  getProductsByBrand, getAllProducts, createProduct, updateProduct, deleteProduct,
  autoSelectOEM, getWOsByBrand, getOEMStats,
} from '../controllers/oemController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Stats
router.get('/stats',       protect, getOEMStats);
router.get('/auto-select', protect, autoSelectOEM);

// Brands
router.get('/',            protect, getAllBrands);
router.get('/:id',         protect, getBrandById);
router.post('/',           protect, createBrand);
router.put('/:id',         protect, updateBrand);
router.delete('/:id',      protect, deleteBrand);

// Products per brand
router.get('/:brandId/products',    protect, getProductsByBrand);
router.get('/:brandId/workorders',  protect, getWOsByBrand);

// All products (cross-brand)
router.get('/products/all',         protect, getAllProducts);

// Product CRUD
router.post('/products',            protect, createProduct);
router.put('/products/:id',         protect, updateProduct);
router.delete('/products/:id',      protect, deleteProduct);

export default router;
