import express from 'express';
import {
  getAllInventoryData,
  getAllWarehousesData,
  getAllMovementsData,
  getAllBatchesData,
  getAgeingStockData,
  getDefectiveStockData,
  getStorageLocationData,
  getPincodeStockData,
  createInventoryItem,
  createWarehouseItem,
  createMovementItem,
  createBatchItem,
  createDefectiveStockItem
} from '../controllers/inventoryDataController.js';

const router = express.Router();

// GET endpoints - no auth required
router.get('/inventory/all', getAllInventoryData);
router.get('/warehouses/all', getAllWarehousesData);
router.get('/movements/all', getAllMovementsData);
router.get('/batches/all', getAllBatchesData);
router.get('/ageing/all', getAgeingStockData);
router.get('/ageing', getAgeingStockData);
router.get('/defective', getDefectiveStockData);
router.get('/storage', getStorageLocationData);
router.get('/pincode', getPincodeStockData);

// POST endpoints - no auth required for testing
router.post('/inventory/create', createInventoryItem);
router.post('/warehouse/create', createWarehouseItem);
router.post('/movement/create', createMovementItem);
router.post('/batch/create', createBatchItem);
router.post('/defective/create', createDefectiveStockItem);

export default router;
