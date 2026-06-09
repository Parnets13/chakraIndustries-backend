import express from 'express';
import SalesOrder from '../../models/SalesOrder.js';
import Invoice from '../../models/Invoice.js';
import InventoryItem from '../../models/InventoryItem.js';
import DocketTracking from '../../models/DocketTracking.js';

const router = express.Router();

// @route   GET /api/dealer/reports/dashboard
// @desc    Get dashboard statistics
// @access  Private
router.get('/dashboard', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateFilter = {};
    
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Get order stats
    const totalOrders = await SalesOrder.countDocuments(dateFilter);
    const pendingOrders = await SalesOrder.countDocuments({
      ...dateFilter,
      status: { $in: ['Pending', 'Processing'] }
    });
    const completedOrders = await SalesOrder.countDocuments({
      ...dateFilter,
      status: 'Delivered'
    });

    // Get total sales amount
    const salesAgg = await SalesOrder.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$totalAmount' },
          avgOrderValue: { $avg: '$totalAmount' }
        }
      }
    ]);

    const salesData = salesAgg.length > 0 ? salesAgg[0] : { totalSales: 0, avgOrderValue: 0 };

    // Get invoice stats
    const totalInvoices = await Invoice.countDocuments(dateFilter);
    const paidInvoices = await Invoice.countDocuments({
      ...dateFilter,
      paymentStatus: 'Paid'
    });
    const pendingInvoices = await Invoice.countDocuments({
      ...dateFilter,
      paymentStatus: { $in: ['Pending', 'Partial'] }
    });

    // Get pending amount
    const pendingAmountAgg = await Invoice.aggregate([
      {
        $match: {
          ...dateFilter,
          paymentStatus: { $in: ['Pending', 'Partial'] }
        }
      },
      {
        $group: {
          _id: null,
          pendingAmount: { $sum: '$remainingAmount' }
        }
      }
    ]);

    const pendingAmount = pendingAmountAgg.length > 0 ? pendingAmountAgg[0].pendingAmount : 0;

    // Get dispatch stats
    const inTransitCount = await DocketTracking.countDocuments({
      currentStatus: { $in: ['In Transit', 'Out for Delivery'] },
      returnType: { $exists: false }
    });

    const deliveredCount = await DocketTracking.countDocuments({
      currentStatus: 'Delivered',
      returnType: { $exists: false },
      ...dateFilter
    });

    // Get low stock items
    const lowStockItems = await InventoryItem.countDocuments({
      currentQuantity: { $lte: '$reorderPoint' }
    });

    res.status(200).json({
      success: true,
      data: {
        orders: {
          total: totalOrders,
          pending: pendingOrders,
          completed: completedOrders
        },
        sales: {
          total: Math.round(salesData.totalSales),
          avgOrderValue: Math.round(salesData.avgOrderValue)
        },
        invoices: {
          total: totalInvoices,
          paid: paidInvoices,
          pending: pendingInvoices,
          pendingAmount: Math.round(pendingAmount)
        },
        dispatch: {
          inTransit: inTransitCount,
          delivered: deliveredCount
        },
        inventory: {
          lowStockItems
        }
      }
    });
  } catch (error) {
    console.error('Dashboard report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
});

// @route   GET /api/dealer/reports/sales
// @desc    Get sales report
// @access  Private
router.get('/sales', async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;
    
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Group by configuration
    const groupByConfig = {
      day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
      month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
      year: { $dateToString: { format: '%Y', date: '$createdAt' } }
    };

    const salesReport = await SalesOrder.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: groupByConfig[groupBy],
          totalOrders: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          avgAmount: { $avg: '$totalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: salesReport.map(item => ({
        date: item._id,
        totalOrders: item.totalOrders,
        totalAmount: Math.round(item.totalAmount),
        avgAmount: Math.round(item.avgAmount)
      }))
    });
  } catch (error) {
    console.error('Sales report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales report'
    });
  }
});

// @route   GET /api/dealer/reports/inventory
// @desc    Get inventory report
// @access  Private
router.get('/inventory', async (req, res) => {
  try {
    const { category, stockStatus } = req.query;
    
    const query = {};
    
    if (category) {
      query.category = category;
    }
    
    if (stockStatus === 'low') {
      query.$expr = { $lte: ['$currentQuantity', '$reorderPoint'] };
    } else if (stockStatus === 'out') {
      query.currentQuantity = 0;
    }

    const inventoryItems = await InventoryItem.find(query)
      .select('itemName category currentQuantity reorderPoint location')
      .sort({ currentQuantity: 1 })
      .lean();

    // Calculate statistics
    const stats = await InventoryItem.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalQuantity: { $sum: '$currentQuantity' },
          lowStockItems: {
            $sum: {
              $cond: [{ $lte: ['$currentQuantity', '$reorderPoint'] }, 1, 0]
            }
          },
          outOfStockItems: {
            $sum: {
              $cond: [{ $eq: ['$currentQuantity', 0] }, 1, 0]
            }
          }
        }
      }
    ]);

    const statistics = stats.length > 0 ? stats[0] : {
      totalItems: 0,
      totalQuantity: 0,
      lowStockItems: 0,
      outOfStockItems: 0
    };

    res.status(200).json({
      success: true,
      data: {
        items: inventoryItems,
        statistics
      }
    });
  } catch (error) {
    console.error('Inventory report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory report'
    });
  }
});

export default router;
