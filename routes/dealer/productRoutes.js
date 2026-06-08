import express from 'express';
const router = express.Router();

// @route   GET /api/dealer/products
// @desc    Get all products
// @access  Private
router.get('/', async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: [],
      pagination: { page: 1, limit: 20, total: 0, pages: 0 }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products'
    });
  }
});

// @route   GET /api/dealer/products/categories
// @desc    Get all categories
// @access  Private
router.get('/categories', async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
});

export default router;
