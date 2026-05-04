import express from 'express';
import {
  getAllInventory, getInventoryStats,
  createInventoryItem, adjustInventoryQty, moveInventoryItem, deleteInventoryItem,
  getWarehouses, createWarehouse, updateWarehouse, deleteWarehouse, getNextWarehouseId,
  getMovements, createMovement, deleteMovement,
  convertGRNToInventory,
} from '../controllers/inventoryController.js';
import {
  getInventoryFlowDashboard,
  getGRNInventoryFlow,
  getInventoryTrends,
} from '../controllers/inventoryFlowController.js';

const router = express.Router();

// Stats (must be before /:id routes)
router.get('/stats',      getInventoryStats);

// Inventory Flow Dashboard
router.get('/flow/dashboard', getInventoryFlowDashboard);
router.get('/flow/trends', getInventoryTrends);
router.get('/flow/grn/:grnId', getGRNInventoryFlow);

// Warehouses
router.get('/warehouses/next-id',    getNextWarehouseId);
router.get('/warehouses',            getWarehouses);
router.post('/warehouses',           createWarehouse);
router.put('/warehouses/:id',        updateWarehouse);
router.delete('/warehouses/:id',     deleteWarehouse);

// Movements
router.get('/movements',       getMovements);
router.post('/movements',      createMovement);
router.delete('/movements/:id', deleteMovement);

// GRN to Inventory conversion
router.post('/convert-grn/:grnId', convertGRNToInventory);

// Inventory items
router.get('/',              getAllInventory);
router.post('/',             createInventoryItem);
router.patch('/:id/adjust',  adjustInventoryQty);
router.patch('/:id/move',    moveInventoryItem);
router.delete('/:id',        deleteInventoryItem);

export default router;
