import Batch from '../models/Batch.js';
import Inventory from '../models/Inventory.js';

// Get all batches
export const getAllBatches = async (req, res) => {
  try {
    const { status, warehouse } = req.query;
    
    let query = {};
    
    if (status && status !== 'All') {
      query.status = status;
    }
    
    if (warehouse) {
      query.warehouse = warehouse;
    }
    
    const batches = await Batch.find(query)
      .populate('inventory', 'sku name')
      .populate('warehouse', 'warehouseId name')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: batches
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching batches',
      error: error.message
    });
  }
};

// Get single batch
export const getBatchById = async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.id)
      .populate('inventory', 'sku name')
      .populate('warehouse', 'warehouseId name');
    
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found'
      });
    }
    
    res.json({
      success: true,
      data: batch
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching batch',
      error: error.message
    });
  }
};

// Create batch
export const createBatch = async (req, res) => {
  try {
    const { inventoryId, quantity, manufacturingDate, expiryDate, warehouse } = req.body;
    
    const inventory = await Inventory.findById(inventoryId);
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    // Generate batch number
    const batchNumber = `B-${new Date(manufacturingDate).getFullYear()}-${String(new Date(manufacturingDate).getMonth() + 1).padStart(2, '0')}`;
    
    const batch = new Batch({
      batchNumber,
      inventory: inventoryId,
      sku: inventory.sku,
      itemName: inventory.name,
      quantity,
      warehouse,
      manufacturingDate,
      expiryDate
    });
    
    await batch.save();
    
    res.status(201).json({
      success: true,
      message: 'Batch created successfully',
      data: batch
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating batch',
      error: error.message
    });
  }
};

// Update batch
export const updateBatch = async (req, res) => {
  try {
    const batch = await Batch.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Batch updated successfully',
      data: batch
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating batch',
      error: error.message
    });
  }
};

// Delete batch
export const deleteBatch = async (req, res) => {
  try {
    const batch = await Batch.findByIdAndDelete(req.params.id);
    
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Batch deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting batch',
      error: error.message
    });
  }
};

// Get ageing stock report
export const getAgeingReport = async (req, res) => {
  try {
    const batches = await Batch.find()
      .populate('inventory', 'sku name unitPrice')
      .populate('warehouse', 'warehouseId name');
    
    const ageingData = batches.map(batch => {
      const daysSinceManufacture = Math.floor((new Date() - new Date(batch.manufacturingDate)) / (1000 * 60 * 60 * 24));
      
      let bucket = '0–30';
      if (daysSinceManufacture > 90) bucket = '90+';
      else if (daysSinceManufacture > 60) bucket = '61–90';
      else if (daysSinceManufacture > 30) bucket = '31–60';
      
      let action = 'No Action';
      let actionColor = '#22c55e';
      
      if (daysSinceManufacture > 90) {
        action = batch.quantity === 0 ? 'Write-off' : 'Return to Supplier';
        actionColor = '#ef4444';
      } else if (daysSinceManufacture > 60) {
        action = 'Offer Discount';
        actionColor = '#f59e0b';
      } else if (daysSinceManufacture > 30) {
        action = 'Monitor';
        actionColor = '#f59e0b';
      }
      
      return {
        batchNumber: batch.batchNumber,
        sku: batch.sku,
        itemName: batch.itemName,
        warehouse: batch.warehouse?.name || 'N/A',
        quantity: batch.quantity,
        lastMovement: batch.manufacturingDate,
        days: daysSinceManufacture,
        bucket,
        value: batch.inventory?.unitPrice ? `₹${(batch.quantity * batch.inventory.unitPrice).toLocaleString()}` : '₹0',
        action,
        actionColor
      };
    });
    
    res.json({
      success: true,
      data: ageingData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating ageing report',
      error: error.message
    });
  }
};
