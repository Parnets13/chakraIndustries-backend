import express from 'express';
import DocketTracking from '../../models/DocketTracking.js';
import SalesOrder from '../../models/SalesOrder.js';
import { protectDealer } from '../../middleware/dealerAuthMiddleware.js';

const router = express.Router();

// Helper to get dealer's sales order IDs
const getDealerSalesOrderIds = async (dealer) => {
  const dealerCustomer = dealer.businessName || dealer.name;
  const baseOr = [];
  if (dealer.erpClientId) baseOr.push({ customerId: dealer.erpClientId });
  if (dealerCustomer) baseOr.push({ customer: { $regex: dealerCustomer, $options: 'i' } });
  if (dealer._id) baseOr.push({ dealerId: dealer._id });
  if (baseOr.length === 0) return [];
  
  const orders = await SalesOrder.find({ $or: baseOr }, { _id: 1 });
  return orders.map(o => o._id);
};

// Helper to get dealer's material return IDs (for return dispatches)
const getDealerMrIds = async (dealer) => {
  const MaterialReturn = (await import('../../models/MaterialReturn.js')).default;
  const baseOr = [];
  if (dealer._id) baseOr.push({ dealerId: dealer._id });
  if (dealer.businessName) baseOr.push({ customerName: { $regex: dealer.businessName, $options: 'i' } });
  if (dealer.name) baseOr.push({ customerName: { $regex: dealer.name, $options: 'i' } });
  if (dealer.name) baseOr.push({ requestedBy: dealer.name });
  
  const returns = await MaterialReturn.find({ $or: baseOr }, { mrId: 1 });
  return returns.map(r => r.mrId);
};

// @route   GET /api/dealer/dispatch
// @desc    Get all dispatches for dealer
// @access  Private
router.get('/', protectDealer, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const dealer = req.dealer;

    // Get dealer's sales order IDs and material return IDs
    const salesOrderIds = await getDealerSalesOrderIds(dealer);
    const mrIds = await getDealerMrIds(dealer);

    // Build query - filter by dealer's sales orders or returns
    const query = {
      $or: [
        { salesOrderId: { $in: salesOrderIds } },
        { mrId: { $in: mrIds } }
      ]
    };
    
    if (status && status !== 'All Orders') {
      if (status === 'In Transit') {
        query.transportStatus = 'in_transit';
      } else if (status === 'Delivered') {
        query.transportStatus = 'delivered';
      } else if (status === 'Pending') {
        query.transportStatus = { $in: ['pickup_pending', 'picked_up'] };
      }
    }

    if (search) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { docketId: { $regex: search, $options: 'i' } },
          { invoiceNo: { $regex: search, $options: 'i' } },
          { courierPartner: { $regex: search, $options: 'i' } },
          { productName: { $regex: search, $options: 'i' } }
        ]
      });
    }

    const dispatches = await DocketTracking.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await DocketTracking.countDocuments(query);

    // Get related sales orders for additional info
    const enrichedDispatches = await Promise.all(
      dispatches.map(async (dispatch) => {
        if (dispatch.salesOrderId) {
          const salesOrder = await SalesOrder.findById(dispatch.salesOrderId)
            .select('orderId value lineItems customer')
            .lean();
          
          return {
            ...dispatch,
            orderDetails: salesOrder
          };
        }
        return dispatch;
      })
    );

    res.status(200).json({
      success: true,
      data: enrichedDispatches,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get dispatches error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dispatches'
    });
  }
});

// @route   GET /api/dealer/dispatch/:id/track
// @desc    Track dispatch with live updates
// @access  Private
router.get('/:id/track', protectDealer, async (req, res) => {
  try {
    const dealer = req.dealer;
    const salesOrderIds = await getDealerSalesOrderIds(dealer);
    const mrIds = await getDealerMrIds(dealer);

    const dispatch = await DocketTracking.findOne({
      _id: req.params.id,
      $or: [
        { salesOrderId: { $in: salesOrderIds } },
        { mrId: { $in: mrIds } }
      ]
    }).lean();

    if (!dispatch) {
      return res.status(404).json({
        success: false,
        message: 'Dispatch not found'
      });
    }

    // Calculate progress percentage
    let progress = 0;
    if (dispatch.transportStatus === 'pickup_pending' || dispatch.transportStatus === 'picked_up') {
      progress = 25;
    } else if (dispatch.transportStatus === 'in_transit') {
      progress = 50;
    } else if (dispatch.transportStatus === 'reached_hub') {
      progress = 75;
    } else if (dispatch.transportStatus === 'out_for_delivery') {
      progress = 90;
    } else if (dispatch.transportStatus === 'delivered') {
      progress = 100;
    }

    res.status(200).json({
      success: true,
      data: {
        ...dispatch,
        progress,
        lastUpdate: dispatch.trackingHistory && dispatch.trackingHistory.length > 0 
          ? dispatch.trackingHistory[dispatch.trackingHistory.length - 1]
          : null
      }
    });
  } catch (error) {
    console.error('Track dispatch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track dispatch'
    });
  }
});

export default router;
