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
    // Auto-generate warehouseId if not provided
    let { warehouseId, ...rest } = req.body;
    if (!warehouseId || !warehouseId.trim()) {
      const last = await Warehouse.findOne().sort({ createdAt: -1 });
      let nextNum = 1;
      if (last && last.warehouseId) {
        const match = last.warehouseId.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1]) + 1;
      }
      warehouseId = `WH-${String(nextNum).padStart(2, '0')}`;
      // Ensure uniqueness
      while (await Warehouse.findOne({ warehouseId })) {
        nextNum++;
        warehouseId = `WH-${String(nextNum).padStart(2, '0')}`;
      }
    }
    const warehouse = new Warehouse({ warehouseId, ...rest });
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

// Get warehouse capacity
export const getWarehouseCapacity = async (req, res) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    const capacityPercent = (warehouse.used / warehouse.capacity) * 100;
    
    res.json({
      success: true,
      data: {
        warehouseId: warehouse.warehouseId,
        totalCapacity: warehouse.capacity,
        usedCapacity: warehouse.used,
        availableCapacity: warehouse.capacity - warehouse.used,
        capacityPercent: Math.round(capacityPercent),
        status: capacityPercent >= 90 ? 'Critical' : capacityPercent >= 80 ? 'Warning' : 'Normal'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching warehouse capacity',
      error: error.message
    });
  }
};

// Get warehouse zones
export const getWarehouseZones = async (req, res) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    res.json({
      success: true,
      data: warehouse.zones || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching warehouse zones',
      error: error.message
    });
  }
};

// Update zone
export const updateZone = async (req, res) => {
  try {
    const { id, zoneId } = req.params;
    const warehouse = await Warehouse.findById(id);
    
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    // Find zone by zoneId (MongoDB _id)
    const zone = warehouse.zones.id(zoneId);
    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Zone not found'
      });
    }
    
    // Update zone properties
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

// Get warehouse summary
export const getWarehouseSummary = async (req, res) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    const skuCount = await Inventory.countDocuments({ warehouse: warehouse._id });
    const totalQuantity = await Inventory.aggregate([
      { $match: { warehouse: warehouse._id } },
      { $group: { _id: null, total: { $sum: '$quantity' } } }
    ]);
    
    const capacityPercent = (warehouse.used / warehouse.capacity) * 100;
    
    res.json({
      success: true,
      data: {
        warehouseId: warehouse.warehouseId,
        name: warehouse.name,
        location: warehouse.location,
        status: warehouse.status,
        totalCapacity: warehouse.capacity,
        usedCapacity: warehouse.used,
        capacityPercent: Math.round(capacityPercent),
        skuCount,
        totalQuantity: totalQuantity[0]?.total || 0,
        zones: warehouse.zones?.length || 0,
        manager: warehouse.manager
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching warehouse summary',
      error: error.message
    });
  }
};

// Sync warehouse capacity from inventory
export const syncWarehouseCapacity = async (req, res) => {
  try {
    const { id } = req.params;
    const warehouse = await Warehouse.findById(id);
    
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    // Calculate total quantity from all inventory items in this warehouse
    const totalQuantity = await Inventory.aggregate([
      { $match: { warehouse: warehouse._id } },
      { $group: { _id: null, total: { $sum: '$quantity' } } }
    ]);
    
    // Update warehouse used capacity
    warehouse.used = totalQuantity[0]?.total || 0;
    await warehouse.save();
    
    res.json({
      success: true,
      message: 'Warehouse capacity synced successfully',
      data: {
        warehouseId: warehouse.warehouseId,
        totalCapacity: warehouse.capacity,
        usedCapacity: warehouse.used,
        availableCapacity: warehouse.capacity - warehouse.used,
        capacityPercent: Math.round((warehouse.used / warehouse.capacity) * 100)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error syncing warehouse capacity',
      error: error.message
    });
  }
};

// Get all warehouses with automatic data
export const getAllWarehousesWithData = async (req, res) => {
  try {
    const warehouses = await Warehouse.find().sort({ createdAt: -1 });
    
    // Calculate complete data for each warehouse
    const warehousesWithData = await Promise.all(
      warehouses.map(async (wh) => {
        const skuCount = await Inventory.countDocuments({ warehouse: wh._id });
        const totalQuantity = await Inventory.aggregate([
          { $match: { warehouse: wh._id } },
          { $group: { _id: null, total: { $sum: '$quantity' } } }
        ]);
        
        const totalQty = totalQuantity[0]?.total || 0;
        const capacityPercent = (totalQty / wh.capacity) * 100;
        
        return {
          ...wh.toObject(),
          skus: skuCount,
          totalQuantity: totalQty,
          usedCapacity: totalQty,
          capacityPercent: Math.round(capacityPercent),
          capacityStatus: capacityPercent >= 90 ? 'Critical' : capacityPercent >= 80 ? 'Warning' : 'Normal'
        };
      })
    );
    
    res.json({
      success: true,
      data: warehousesWithData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching warehouses with data',
      error: error.message
    });
  }
};
