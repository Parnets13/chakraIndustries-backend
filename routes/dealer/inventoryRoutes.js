import express from 'express';
const router = express.Router();

// @route   GET /api/dealer/inventory
// @desc    Get inventory
// @access  Private
router.get('/', async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory'
    });
  }
});

export default router;
