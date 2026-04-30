import Inventory from '../models/Inventory.js';
import Warehouse from '../models/Warehouse.js';
import StockMovement from '../models/StockMovement.js';

// Get all inventory items
export const getAllInventory = async (req, res) => {
  try {
    const { status, warehouse, search } = req.query;
    
    let query = {};
    
    if (status && status !== 'All') {
      query.status = status;
    }
    
    if (warehouse) {
      query.warehouse = warehouse;
    }
    
    if (search) {
      query.$or = [
        { sku: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }
    
    const inventory = await Inventory.find(query)
      .populate('warehouse', 'warehouseId name location')
      .populate('category', 'name')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: inventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching inventory',
      error: error.message
    });
  }
};

// Get single inventory item
export const getInventoryById = async (req, res) => {
  try {
    const inventory = await Inventory.findById(req.params.id)
      .populate('warehouse', 'warehouseId name location')
      .populate('category', 'name');
    
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    res.json({
      success: true,
      data: inventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching inventory item',
      error: error.message
    });
  }
};

// Create inventory item
export const createInventory = async (req, res) => {
  try {
    const inventory = new Inventory(req.body);
    await inventory.save();
    
    // Update warehouse used capacity
    if (inventory.warehouse) {
      await Warehouse.findByIdAndUpdate(
        inventory.warehouse,
        { $inc: { used: inventory.quantity } }
      );
    }
    
    res.status(201).json({
      success: true,
      message: 'Inventory item created successfully',
      data: inventory
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating inventory item',
      error: error.message
    });
  }
};

// Update inventory item
export const updateInventory = async (req, res) => {
  try {
    const oldInventory = await Inventory.findById(req.params.id);
    
    if (!oldInventory) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    const inventory = await Inventory.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    // Update warehouse capacity if quantity changed
    if (oldInventory.quantity !== inventory.quantity) {
      const diff = inventory.quantity - oldInventory.quantity;
      await Warehouse.findByIdAndUpdate(
        inventory.warehouse,
        { $inc: { used: diff } }
      );
    }
    
    res.json({
      success: true,
      message: 'Inventory item updated successfully',
      data: inventory
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating inventory item',
      error: error.message
    });
  }
};

// Delete inventory item
export const deleteInventory = async (req, res) => {
  try {
    const inventory = await Inventory.findById(req.params.id);
    
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    // Update warehouse capacity
    await Warehouse.findByIdAndUpdate(
      inventory.warehouse,
      { $inc: { used: -inventory.quantity } }
    );
    
    await Inventory.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Inventory item deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting inventory item',
      error: error.message
    });
  }
};

// Adjust stock quantity
export const adjustStock = async (req, res) => {
  try {
    const { quantity, reason, reference } = req.body;
    const inventory = await Inventory.findById(req.params.id);
    
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    const oldQty = inventory.quantity;
    inventory.quantity = quantity;
    await inventory.save();
    
    // Create stock movement record
    const movementId = `MV-${Date.now()}`;
    await StockMovement.create({
      movementId,
      type: 'Adjustment',
      inventory: inventory._id,
      sku: inventory.sku,
      itemName: inventory.name,
      quantity: Math.abs(quantity - oldQty),
      from: quantity < oldQty ? inventory.warehouse : 'Adjustment',
      to: quantity > oldQty ? inventory.warehouse : 'Adjustment',
      reference,
      remarks: reason,
      performedBy: req.user?._id
    });
    
    // Update warehouse capacity
    const diff = quantity - oldQty;
    await Warehouse.findByIdAndUpdate(
      inventory.warehouse,
      { $inc: { used: diff } }
    );
    
    res.json({
      success: true,
      message: 'Stock adjusted successfully',
      data: inventory
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error adjusting stock',
      error: error.message
    });
  }
};

// Get inventory dashboard stats
export const getDashboardStats = async (req, res) => {
  try {
    const totalStock = await Inventory.aggregate([
      { $group: { _id: null, total: { $sum: '$quantity' } } }
    ]);
    
    const lowStock = await Inventory.countDocuments({
      $expr: { $and: [{ $lt: ['$quantity', '$minQuantity'] }, { $gt: ['$quantity', 0] }] }
    });
    
    const deadStock = await Inventory.countDocuments({ quantity: 0 });
    
    const activeSkus = await Inventory.countDocuments({ status: 'Active' });
    
    const stockByCategory = await Inventory.aggregate([
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      { $unwind: { path: '$categoryInfo', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$categoryInfo.name',
          value: { $sum: '$quantity' }
        }
      },
      { $project: { label: '$_id', value: 1, _id: 0 } }
    ]);
    
    res.json({
      success: true,
      data: {
        totalStock: totalStock[0]?.total || 0,
        lowStock,
        deadStock,
        activeSkus,
        stockByCategory
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard stats',
      error: error.message
    });
  }
};

// Get stock by warehouse
export const getStockByWarehouse = async (req, res) => {
  try {
    const { warehouseId } = req.params;
    
    const stock = await Inventory.find({ warehouse: warehouseId })
      .populate('warehouse', 'warehouseId name')
      .populate('category', 'name');
    
    res.json({
      success: true,
      data: stock
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching warehouse stock',
      error: error.message
    });
  }
};

// Get stock by location
export const getStockByLocation = async (req, res) => {
  try {
    const { locationId } = req.params;
    
    const stock = await Inventory.find({
      'location.zone': locationId
    }).populate('warehouse', 'warehouseId name');
    
    res.json({
      success: true,
      data: stock
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching location stock',
      error: error.message
    });
  }
};

// Get stock by SKU
export const getStockBySKU = async (req, res) => {
  try {
    const { sku } = req.params;
    
    const stock = await Inventory.findOne({ sku: sku.toUpperCase() })
      .populate('warehouse', 'warehouseId name')
      .populate('category', 'name');
    
    if (!stock) {
      return res.status(404).json({
        success: false,
        message: 'SKU not found'
      });
    }
    
    res.json({
      success: true,
      data: stock
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stock by SKU',
      error: error.message
    });
  }
};

// Get stock type breakdown for SKU
export const getStockTypeBreakdown = async (req, res) => {
  try {
    const { sku } = req.params;
    
    const inventory = await Inventory.findOne({ sku: sku.toUpperCase() });
    
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: 'SKU not found'
      });
    }
    
    // Calculate stock breakdown based on status and quantity
    const breakdown = {
      sku: inventory.sku,
      itemName: inventory.name,
      total: inventory.quantity,
      available: inventory.status === 'Active' ? inventory.quantity : 0,
      reserved: 0,
      damaged: 0,
      expired: 0,
      transit: 0
    };
    
    res.json({
      success: true,
      data: breakdown
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stock breakdown',
      error: error.message
    });
  }
};

// Get all stock with filters
export const getAllStock = async (req, res) => {
  try {
    const { sku, type, warehouse, status } = req.query;
    
    let query = {};
    
    if (sku) {
      query.sku = { $regex: sku, $options: 'i' };
    }
    
    if (warehouse) {
      query.warehouse = warehouse;
    }
    
    if (status) {
      query.status = status;
    }
    
    const stock = await Inventory.find(query)
      .populate('warehouse', 'warehouseId name')
      .populate('category', 'name')
      .sort({ sku: 1 });
    
    // Add stock type breakdown
    const stockWithBreakdown = stock.map(item => ({
      ...item.toObject(),
      available: item.status === 'Active' ? item.quantity : 0,
      reserved: 0,
      damaged: 0,
      expired: 0,
      transit: 0,
      total: item.quantity
    }));
    
    res.json({
      success: true,
      data: stockWithBreakdown
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stock',
      error: error.message
    });
  }
};
