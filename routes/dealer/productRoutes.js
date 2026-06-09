import express from 'express';
import InventoryItem from '../../models/InventoryItem.js';
import Category from '../../models/Category.js';

const router = express.Router();

// @route   GET /api/dealer/products
// @desc    Get all products with inventory
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20, inStock } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    
    if (category && category !== 'All' && category !== 'All Products') {
      query.category = category;
    }

    if (search) {
      query.$or = [
        { itemName: { $regex: search, $options: 'i' } },
        { itemCode: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    if (inStock === 'true') {
      query.currentQuantity = { $gt: 0 };
    }

    const products = await InventoryItem.find(query)
      .sort({ itemName: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await InventoryItem.countDocuments(query);

    // Transform to dealer format
    const transformedProducts = products.map(product => ({
      id: product._id,
      name: product.itemName,
      sku: product.itemCode || product._id.toString().slice(-6).toUpperCase(),
      price: product.unitPrice || 0,
      moq: product.moq || 24,
      stock: product.currentQuantity || 0,
      category: product.category || 'Uncategorized',
      stockStatus: product.currentQuantity === 0 ? 'Out of Stock' 
        : product.currentQuantity <= (product.reorderPoint || 10) ? 'Low Stock' 
        : 'In Stock'
    }));

    res.status(200).json({
      success: true,
      data: transformedProducts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products'
    });
  }
});

// @route   GET /api/dealer/products/categories
// @desc    Get all product categories dynamically from Master Category list
// @access  Private
router.get('/categories', async (req, res) => {
  try {
    // Fetch all categories from the Master Category model
    const categories = await Category.find().sort({ name: 1 }).lean();
    
    // Get product counts per category from inventory
    const categoriesWithCounts = await Promise.all(
      categories.map(async (cat) => {
        const productCount = await InventoryItem.countDocuments({ 
          category: cat.name 
        });

        return {
          id: cat._id,
          name: cat.name,
          productCount: productCount,
          status: 'Active' // All master categories are active for selection
        };
      })
    );

    res.status(200).json({
      success: true,
      data: categoriesWithCounts
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
});

// @route   GET /api/dealer/products/:id
// @desc    Get product details
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const product = await InventoryItem.findById(req.params.id).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: product._id,
        name: product.itemName,
        sku: product.itemCode || product._id.toString().slice(-6).toUpperCase(),
        price: product.unitPrice || 0,
        moq: product.moq || 24,
        stock: product.currentQuantity || 0,
        category: product.category || 'Uncategorized',
        description: product.description || '',
        unit: product.unit || 'pcs',
        warehouse: product.location || 'Main Warehouse',
        stockStatus: product.currentQuantity === 0 ? 'Out of Stock' 
          : product.currentQuantity <= (product.reorderPoint || 10) ? 'Low Stock' 
          : 'In Stock'
      }
    });
  } catch (error) {
    console.error('Get product details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product details'
    });
  }
});

// @route   GET /api/dealer/products/search
// @desc    Search products
// @access  Private
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query too short'
      });
    }

    const products = await InventoryItem.find({
      $or: [
        { itemName: { $regex: q, $options: 'i' } },
        { itemCode: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } }
      ]
    })
    .limit(20)
    .lean();

    const transformedProducts = products.map(product => ({
      id: product._id,
      name: product.itemName,
      sku: product.itemCode || product._id.toString().slice(-6).toUpperCase(),
      price: product.unitPrice || 0,
      stock: product.currentQuantity || 0,
      category: product.category || 'Uncategorized'
    }));

    res.status(200).json({
      success: true,
      data: transformedProducts
    });
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search products'
    });
  }
});

export default router;
