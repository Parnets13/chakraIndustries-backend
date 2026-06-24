import express from 'express';
import ItemMaster from '../../models/ItemMaster.js';
import Inventory from '../../models/Inventory.js';
import Warehouse from '../../models/Warehouse.js';
import Category from '../../models/Category.js';

const router = express.Router();

// @route   GET /api/dealer/inventory/warehouses
// @desc    Get list of warehouses
// @access  Private
router.get('/warehouses', async (req, res) => {
  try {
    console.log('Fetching warehouses...');
    const warehouses = await Warehouse.find({ status: 'Active' }).sort({ name: 1 }).lean();
    console.log(`Found ${warehouses.length} warehouses`);
    
    const transformedWarehouses = warehouses.map(wh => ({
      id: wh._id,
      name: wh.name,
      location: wh.location,
      city: wh.city,
      state: wh.state
    }));

    res.status(200).json({
      success: true,
      data: transformedWarehouses
    });
  } catch (error) {
    console.error('Get warehouses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch warehouses'
    });
  }
});

// @route   GET /api/dealer/inventory
// @desc    Get all inventory items from ItemMaster with stock from Inventory
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { search, page = 1, limit = 100 } = req.query;
    const skip = (page - 1) * limit;

    console.log('=== Fetching Inventory from ItemMaster ===');

    // Build query
    const query = { isActive: true, status: 'Active' };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { itemId: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { hsn: { $regex: search, $options: 'i' } }
      ];
    }

    console.log('Query:', query);
    
    // Fetch items from ItemMaster with category populated
    const items = await ItemMaster.find(query)
      .populate('category')
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await ItemMaster.countDocuments(query);

    console.log(`Found ${items.length} items from ItemMaster (total: ${total})`);
    console.log('First item:', items[0] ? { id: items[0]._id, name: items[0].name, sku: items[0].sku } : 'No items');

    // For each item, fetch inventory data and warehouses
    const transformedItems = await Promise.all(items.map(async (item) => {
      // Get inventory records for this item
      const inventoryRecords = await Inventory.find({ 
        itemMasterId: item._id,
        status: { $in: ['Active', 'Critical'] }
      }).populate('warehouse').lean();

      console.log(`Item ${item.name} has ${inventoryRecords.length} inventory records`);

      // Calculate total stock
      const totalStock = inventoryRecords.reduce((sum, inv) => 
        sum + (inv.availableQuantity || 0), 0
      );

      const totalStockAll = inventoryRecords.reduce((sum, inv) => 
        sum + (inv.totalQuantity || 0), 0
      );

      // Collect warehouse info
      const warehouses = inventoryRecords.map(inv => ({
        id: inv.warehouse?._id,
        name: inv.warehouse?.name || 'Main Warehouse',
        stock: inv.availableQuantity || 0,
        total: inv.totalQuantity || 0,
        batch: inv.batch || ''
      }));

      // Determine status based on stock
      const minQty = item.minQuantity || item.reorderPoint || 10;
      const status = totalStock === 0 
        ? 'Out of Stock' 
        : totalStock <= minQty 
          ? 'Low Stock' 
          : 'In Stock';

      // Get category name
      const categoryName = item.category?.name || item.category || 'General';

      // Build the transformed item with all fields from ItemMaster
      const transformedItem = {
        id: item._id,
        _id: item._id,
        
        // Basic info
        name: item.name,
        itemName: item.name,
        sku: item.sku,
        itemId: item.itemId,
        description: item.description || '',
        
        // Stock info
        stock: totalStock,
        totalStock: totalStockAll,
        minQuantity: item.minQuantity || 0,
        minQty: item.minQuantity || item.reorderPoint || 1,
        reorderPoint: item.reorderPoint || 0,
        unit: item.unit || 'Nos',
        warehouses: warehouses,
        
        // Pricing
        unitPrice: item.unitPrice || 0,
        price: item.unitPrice ? `₹${item.unitPrice.toLocaleString('en-IN')}` : '₹0',
        costPrice: item.costPrice || 0,
        sellingPrice: item.sellingPrice || item.unitPrice || 0,
        
        // Taxes & codes
        gst: item.gst || 0,
        gstRate: item.gst || 0,
        hsn: item.hsn || '',
        hsnCode: item.hsn || '',
        barcode: item.barcode || '',
        
        // Classification
        category: categoryName,
        categoryId: item.category?._id,
        
        // Status
        stockStatus: status,
        status: status,
        
        // Tally info
        tallyGuid: item.tallyGuid || '',
        tallyStockName: item.tallyStockName || '',
        
        // Timestamps
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      };

      console.log('Transformed item:', { name: transformedItem.name, stock: transformedItem.stock, price: transformedItem.price });
      return transformedItem;
    }));

    // Get statistics
    const stats = {
      total: total,
      inStock: transformedItems.filter(i => i.status === 'In Stock').length,
      lowStock: transformedItems.filter(i => i.status === 'Low Stock').length,
      outOfStock: transformedItems.filter(i => i.status === 'Out of Stock').length
    };

    console.log('=== Final Response ===');
    console.log('Stats:', stats);

    res.status(200).json({
      success: true,
      data: transformedItems,
      statistics: stats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory',
      error: error.message
    });
  }
});

export default router;
