import DefectiveStock from '../models/DefectiveStock.js';
import Inventory from '../models/Inventory.js';

// Get all defective stock
export const getAllDefectiveStock = async (req, res) => {
  try {
    const { stage, source } = req.query;
    
    let query = {};
    
    if (stage) {
      query.stage = stage;
    }
    
    if (source) {
      query.source = source;
    }
    
    const defectiveStock = await DefectiveStock.find(query)
      .populate('inventory', 'sku name warehouse')
      .populate('reportedBy', 'name email')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: defectiveStock
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching defective stock',
      error: error.message
    });
  }
};

// Get single defective stock
export const getDefectiveStockById = async (req, res) => {
  try {
    const defectiveStock = await DefectiveStock.findById(req.params.id)
      .populate('inventory', 'sku name warehouse')
      .populate('reportedBy', 'name email');
    
    if (!defectiveStock) {
      return res.status(404).json({
        success: false,
        message: 'Defective stock not found'
      });
    }
    
    res.json({
      success: true,
      data: defectiveStock
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching defective stock',
      error: error.message
    });
  }
};

// Create defective stock record
export const createDefectiveStock = async (req, res) => {
  try {
    const { inventoryId, quantity, defectType, source, remarks } = req.body;
    
    const inventory = await Inventory.findById(inventoryId);
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    // Generate defect ID
    const defectId = `DEF-${String(await DefectiveStock.countDocuments() + 1).padStart(3, '0')}`;
    
    const defectiveStock = new DefectiveStock({
      defectId,
      inventory: inventoryId,
      sku: inventory.sku,
      itemName: inventory.name,
      quantity,
      defectType,
      source,
      remarks,
      reportedBy: req.user?._id
    });
    
    await defectiveStock.save();
    
    // Reduce inventory quantity
    inventory.quantity = Math.max(0, inventory.quantity - quantity);
    await inventory.save();
    
    res.status(201).json({
      success: true,
      message: 'Defective stock recorded successfully',
      data: defectiveStock
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating defective stock record',
      error: error.message
    });
  }
};

// Update defective stock
export const updateDefectiveStock = async (req, res) => {
  try {
    const defectiveStock = await DefectiveStock.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!defectiveStock) {
      return res.status(404).json({
        success: false,
        message: 'Defective stock not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Defective stock updated successfully',
      data: defectiveStock
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating defective stock',
      error: error.message
    });
  }
};

// Update defective stock stage
export const updateStage = async (req, res) => {
  try {
    const { stage, remarks } = req.body;
    
    const defectiveStock = await DefectiveStock.findById(req.params.id);
    
    if (!defectiveStock) {
      return res.status(404).json({
        success: false,
        message: 'Defective stock not found'
      });
    }
    
    defectiveStock.stage = stage;
    if (remarks) {
      defectiveStock.remarks = remarks;
    }
    
    await defectiveStock.save();
    
    res.json({
      success: true,
      message: 'Defective stock stage updated successfully',
      data: defectiveStock
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating defective stock stage',
      error: error.message
    });
  }
};

// Delete defective stock
export const deleteDefectiveStock = async (req, res) => {
  try {
    const defectiveStock = await DefectiveStock.findByIdAndDelete(req.params.id);
    
    if (!defectiveStock) {
      return res.status(404).json({
        success: false,
        message: 'Defective stock not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Defective stock record deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting defective stock',
      error: error.message
    });
  }
};
