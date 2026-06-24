import express from 'express';
import DocketTracking from '../../models/DocketTracking.js';
import SalesOrder from '../../models/SalesOrder.js';

const router = express.Router();

// @route   GET /api/dealer/dispatch
// @desc    Get all dispatches for dealer
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    const query = { returnType: { $exists: false } }; // Exclude returns
    
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
      query.$or = [
        { docketId: { $regex: search, $options: 'i' } },
        { invoiceNo: { $regex: search, $options: 'i' } },
        { courierPartner: { $regex: search, $options: 'i' } }
      ];
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
            .select('orderId value lineItems')
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
router.get('/:id/track', async (req, res) => {
  try {
    const dispatch = await DocketTracking.findById(req.params.id).lean();

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
