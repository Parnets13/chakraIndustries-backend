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

// GET endpoints
router.get('/all', getAllInventoryData);
router.get('/warehouses', getAllWarehousesData);
router.get('/movements', getAllMovementsData);
router.get('/batches', getAllBatchesData);
router.get('/ageing', getAgeingStockData);
router.get('/defective', getDefectiveStockData);
router.get('/storage', getStorageLocationData);
router.get('/pincode', getPincodeStockData);

// POST endpoints
router.post('/inventory/create', createInventoryItem);
router.post('/warehouse/create', createWarehouseItem);
router.post('/movement/create', createMovementItem);
router.post('/batch/create', createBatchItem);
router.post('/defective/create', createDefectiveStockItem);

export default router;
