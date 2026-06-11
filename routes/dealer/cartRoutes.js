import express from 'express';
const router = express.Router();

// @route   GET /api/dealer/cart
// @desc    Get cart
// @access  Private
router.get('/', async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: { items: [], totalItems: 0, totalAmount: 0 }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cart'
    });
  }
});

// @route   POST /api/dealer/cart/add
// @desc    Add to cart
// @access  Private
router.post('/add', async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      message: 'Added to cart'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to add to cart'
    });
  }
});

export default router;
