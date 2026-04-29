import StockMovement from '../models/StockMovement.js';
import Inventory from '../models/Inventory.js';
import Warehouse from '../models/Warehouse.js';

// Get all stock movements
export const getAllMovements = async (req, res) => {
  try {
    const { type, startDate, endDate } = req.query;
    
    let query = {};
    
    if (type && type !== 'All') {
      query.type = type;
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const movements = await StockMovement.find(query)
      .populate('inventory', 'sku name')
      .populate('performedBy', 'name email')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: movements
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stock movements',
      error: error.message
    });
  }
};

// Get single movement
export const getMovementById = async (req, res) => {
  try {
    const movement = await StockMovement.findById(req.params.id)
      .populate('inventory', 'sku name')
      .populate('performedBy', 'name email');
    
    if (!movement) {
      return res.status(404).json({
        success: false,
        message: 'Stock movement not found'
      });
    }
    
    res.json({
      success: true,
      data: movement
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stock movement',
      error: error.message
    });
  }
};

// Create stock movement
export const createMovement = async (req, res) => {
  try {
    const { type, inventoryId, quantity, from, to, reference, remarks } = req.body;
    
    const inventory = await Inventory.findById(inventoryId);
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    // Generate movement ID
    const movementId = `MV-${Date.now()}`;
    
    const movement = new StockMovement({
      movementId,
      type,
      inventory: inventoryId,
      sku: inventory.sku,
      itemName: inventory.name,
      quantity,
      from,
      to,
      reference,
      remarks,
      performedBy: req.user?._id
    });
    
    await movement.save();
    
    // Update inventory quantity based on movement type
    if (type === 'Inward') {
      inventory.quantity += quantity;
    } else if (type === 'Outward') {
      if (inventory.quantity < quantity) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock quantity'
        });
      }
      inventory.quantity -= quantity;
    }
    
    await inventory.save();
    
    res.status(201).json({
      success: true,
      message: 'Stock movement recorded successfully',
      data: movement
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating stock movement',
      error: error.message
    });
  }
};

// Transfer stock between warehouses
export const transferStock = async (req, res) => {
  try {
    const { inventoryId, quantity, fromWarehouse, toWarehouse, reference, remarks } = req.body;
    
    const inventory = await Inventory.findById(inventoryId);
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    if (inventory.quantity < quantity) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient stock quantity'
      });
    }
    
    const fromWh = await Warehouse.findById(fromWarehouse);
    const toWh = await Warehouse.findById(toWarehouse);
    
    if (!fromWh || !toWh) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    // Generate movement ID
    const movementId = `MV-${Date.now()}`;
    
    const movement = new StockMovement({
      movementId,
      type: 'Transfer',
      inventory: inventoryId,
      sku: inventory.sku,
      itemName: inventory.name,
      quantity,
      from: fromWh.name,
      to: toWh.name,
      reference,
      remarks,
      performedBy: req.user?._id
    });
    
    await movement.save();
    
    // Update warehouse capacities
    await Warehouse.findByIdAndUpdate(fromWarehouse, { $inc: { used: -quantity } });
    await Warehouse.findByIdAndUpdate(toWarehouse, { $inc: { used: quantity } });
    
    // Update inventory warehouse
    inventory.warehouse = toWarehouse;
    await inventory.save();
    
    res.status(201).json({
      success: true,
      message: 'Stock transferred successfully',
      data: movement
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error transferring stock',
      error: error.message
    });
  }
};

// Delete movement
export const deleteMovement = async (req, res) => {
  try {
    const movement = await StockMovement.findByIdAndDelete(req.params.id);
    
    if (!movement) {
      return res.status(404).json({
        success: false,
        message: 'Stock movement not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Stock movement deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting stock movement',
      error: error.message
    });
  }
};
