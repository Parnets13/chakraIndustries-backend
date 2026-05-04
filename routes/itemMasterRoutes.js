import express from 'express';
import {
  createItem,
  getAllItems,
  getItemById,
  getItemBySku,
  updateItem,
  deleteItem,
  searchItems,
  getItemsForDropdown,
  getItemStats
} from '../controllers/itemMasterController.js';

const router = express.Router();

// Stats (must be before /:id routes)
router.get('/stats', getItemStats);

// Dropdown - Get items for dropdown
router.get('/dropdown', getItemsForDropdown);

// Search - Search items
router.get('/search', searchItems);

// CRUD operations
router.get('/', getAllItems);
router.post('/', createItem);
router.get('/sku/:sku', getItemBySku);
router.get('/:id', getItemById);
router.put('/:id', updateItem);
router.delete('/:id', deleteItem);

export default router;
