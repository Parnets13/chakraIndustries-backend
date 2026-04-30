import express from 'express';
import {
  getAllInventory, getInventoryStats,
  createInventoryItem, adjustInventoryQty, moveInventoryItem, deleteInventoryItem,
  getWarehouses, createWarehouse, updateWarehouse, deleteWarehouse, getNextWarehouseId,
  getMovements, createMovement, deleteMovement,
} from '../controllers/inventoryController.js';

const router = express.Router();

// Stats (must be before /:id routes)
router.get('/stats',      getInventoryStats);

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

// Inventory items
router.get('/',              getAllInventory);
router.post('/',             createInventoryItem);
router.patch('/:id/adjust',  adjustInventoryQty);
router.patch('/:id/move',    moveInventoryItem);
router.delete('/:id',        deleteInventoryItem);

export default router;
