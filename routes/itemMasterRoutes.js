import express from 'express';
import {
  createItem,
  getAllItems,
  getItemById,
  getItemBySku,
  updateItem,
  deleteItem,
  deleteAllItems,
  searchItems,
  getItemsForDropdown,
  getItemStats,
  getItemByBarcode,
  regenerateBarcode,
} from '../controllers/itemMasterController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Stats (must be before /:id routes)
router.get('/stats', protect, getItemStats);

// Dropdown - Get items for dropdown
router.get('/dropdown', protect, getItemsForDropdown);

// Search - Search items
router.get('/search', protect, searchItems);

// Barcode lookup — find product by barcode value
router.get('/barcode/:barcode', protect, getItemByBarcode);

// CRUD operations
router.get('/',          protect, getAllItems);
router.post('/',         protect, createItem);
router.delete('/delete-all', protect, deleteAllItems);
router.get('/sku/:sku',  protect, getItemBySku);
router.get('/:id',       protect, getItemById);
router.put('/:id',       protect, updateItem);
router.delete('/:id',    protect, deleteItem);

// Admin-only: regenerate barcode for an existing item
router.post('/:id/regenerate-barcode', protect, authorize('super_admin'), regenerateBarcode);

export default router;
