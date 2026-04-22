import Warehouse from '../models/Warehouse.js';
import Inventory from '../models/Inventory.js';

// Get all warehouses
export const getAllWarehouses = async (req, res) => {
  try {
    const warehouses = await Warehouse.find().sort({ createdAt: -1 });
    
    // Calculate SKU count for each warehouse
    const warehousesWithSkus = await Promise.all(
      warehouses.map(async (wh) => {
        const skuCount = await Inventory.countDocuments({ warehouse: wh._id });
        return {
          ...wh.toObject(),
          skus: skuCount
        };
      })
    );
    
    res.json({
      success: true,
      data: warehousesWithSkus
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching warehouses',
      error: error.message
    });
  }
};

// Get single warehouse
export const getWarehouseById = async (req, res) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    const skuCount = await Inventory.countDocuments({ warehouse: warehouse._id });
    
    res.json({
      success: true,
      data: {
        ...warehouse.toObject(),
        skus: skuCount
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching warehouse',
      error: error.message
    });
  }
};

// Create warehouse
export const createWarehouse = async (req, res) => {
  try {
    const warehouse = new Warehouse(req.body);
    await warehouse.save();
    
    res.status(201).json({
      success: true,
      message: 'Warehouse created successfully',
      data: warehouse
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating warehouse',
      error: error.message
    });
  }
};

// Update warehouse
export const updateWarehouse = async (req, res) => {
  try {
    const warehouse = await Warehouse.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Warehouse updated successfully',
      data: warehouse
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating warehouse',
      error: error.message
    });
  }
};

// Delete warehouse
export const deleteWarehouse = async (req, res) => {
  try {
    const inventoryCount = await Inventory.countDocuments({ warehouse: req.params.id });
    
    if (inventoryCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete warehouse with existing inventory items'
      });
    }
    
    const warehouse = await Warehouse.findByIdAndDelete(req.params.id);
    
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Warehouse deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting warehouse',
      error: error.message
    });
  }
};

// Add zone to warehouse
export const addZone = async (req, res) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    warehouse.zones.push(req.body);
    await warehouse.save();
    
    res.json({
      success: true,
      message: 'Zone added successfully',
      data: warehouse
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error adding zone',
      error: error.message
    });
  }
};

// Update zone
export const updateZone = async (req, res) => {
  try {
    const { zoneId } = req.params; // This is the MongoDB _id of the subdocument
    const warehouse = await Warehouse.findById(req.params.id);
    
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    // .id() is a Mongoose method that finds subdocument by its _id
    // It searches warehouse.zones array for a subdocument with _id === zoneId
    const zone = warehouse.zones.id(zoneId);
    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Zone not found'
      });
    }
    
    // Update the zone subdocument
    Object.assign(zone, req.body);
    await warehouse.save();
    
    res.json({
      success: true,
      message: 'Zone updated successfully',
      data: warehouse
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating zone',
      error: error.message
    });
  }
};
