import express from 'express';
import InventoryItem from '../../models/InventoryItem.js';

const router = express.Router();

// @route   GET /api/dealer/inventory
// @desc    Get inventory for dealer with stock levels
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { search, stockStatus, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    
    if (search) {
      query.$or = [
        { itemName: { $regex: search, $options: 'i' } },
        { itemCode: { $regex: search, $options: 'i' } }
      ];
    }

    if (stockStatus) {
      if (stockStatus === 'In Stock') {
        query.$expr = { $gt: ['$currentQuantity', '$reorderPoint'] };
      } else if (stockStatus === 'Low Stock') {
        query.$expr = { 
          $and: [
            { $lte: ['$currentQuantity', '$reorderPoint'] },
            { $gt: ['$currentQuantity', 0] }
          ]
        };
      } else if (stockStatus === 'Out of Stock') {
        query.currentQuantity = 0;
      }
    }

    const items = await InventoryItem.find(query)
      .sort({ itemName: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await InventoryItem.countDocuments(query);

    // Get statistics
    const stats = await InventoryItem.aggregate([
      {
        $facet: {
          totalItems: [{ $count: 'count' }],
          inStock: [
            { $match: { $expr: { $gt: ['$currentQuantity', '$reorderPoint'] } } },
            { $count: 'count' }
          ],
          lowStock: [
            { 
              $match: { 
                $expr: { 
                  $and: [
                    { $lte: ['$currentQuantity', '$reorderPoint'] },
                    { $gt: ['$currentQuantity', 0] }
                  ]
                }
              }
            },
            { $count: 'count' }
          ],
          outOfStock: [
            { $match: { currentQuantity: 0 } },
            { $count: 'count' }
          ]
        }
      }
    ]);

    const statistics = {
      total: stats[0].totalItems[0]?.count || 0,
      inStock: stats[0].inStock[0]?.count || 0,
      lowStock: stats[0].lowStock[0]?.count || 0,
      outOfStock: stats[0].outOfStock[0]?.count || 0
    };

    // Transform items
    const transformedItems = items.map(item => ({
      id: item._id,
      name: item.itemName,
      sku: item.itemCode || item._id.toString().slice(-6).toUpperCase(),
      stock: item.currentQuantity || 0,
      warehouse: item.location || 'Main Warehouse',
      batch: item.batchNumber || `BTH${new Date().getFullYear()}${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      status: item.currentQuantity === 0 ? 'Out of Stock' 
        : item.currentQuantity <= (item.reorderPoint || 10) ? 'Low Stock' 
        : 'In Stock'
    }));

    res.status(200).json({
      success: true,
      data: transformedItems,
      statistics,
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
      message: 'Failed to fetch inventory'
    });
  }
});

// @route   GET /api/dealer/inventory/product/:productId
// @desc    Get inventory for specific product
// @access  Private
router.get('/product/:productId', async (req, res) => {
  try {
    const product = await InventoryItem.findById(req.params.productId).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        productId: product._id,
        name: product.itemName,
        currentStock: product.currentQuantity || 0,
        reorderPoint: product.reorderPoint || 10,
        warehouse: product.location || 'Main Warehouse',
        status: product.currentQuantity === 0 ? 'Out of Stock' 
          : product.currentQuantity <= (product.reorderPoint || 10) ? 'Low Stock' 
          : 'In Stock'
      }
    });
  } catch (error) {
    console.error('Get product inventory error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product inventory'
    });
  }
});

export default router;
