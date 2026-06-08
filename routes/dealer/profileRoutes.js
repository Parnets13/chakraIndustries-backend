import express from 'express';
const router = express.Router();

// @route   GET /api/dealer/profile/dashboard
// @desc    Get dealer dashboard data
// @access  Private
router.get('/dashboard', async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        dealer: {
          name: 'Demo Dealer',
          dealerCode: 'DL-001',
          zone: 'South',
          creditLimit: 500000,
          usedCredit: 245000,
          outstandingAmount: 245000,
          availableCredit: 255000
        },
        stats: {
          totalOrders: 28,
          monthOrders: 12,
          pendingOrders: 3,
          monthlyPurchaseAmount: 840000,
          pendingInvoices: 2,
          unreadNotifications: 3
        },
        recentOrders: []
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard'
    });
  }
});

export default router;
