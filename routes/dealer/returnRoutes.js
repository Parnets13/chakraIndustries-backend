import express from 'express';
import DocketTracking from '../../models/DocketTracking.js';
import Invoice from '../../models/Invoice.js';

const router = express.Router();

// @route   GET /api/dealer/returns
// @desc    Get all returns for dealer
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    
    if (status && status !== 'All') {
      if (status === 'In Transit') {
        query.currentStatus = { $in: ['In Transit', 'Out for Delivery'] };
      } else if (status === 'Closed') {
        query.currentStatus = 'Delivered';
      } else {
        query.currentStatus = status;
      }
    }

    if (search) {
      query.$or = [
        { docketNumber: { $regex: search, $options: 'i' } },
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { courierName: { $regex: search, $options: 'i' } }
      ];
    }

    // For returns, we filter by returnType
    query.returnType = { $exists: true, $ne: null };

    const returns = await DocketTracking.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await DocketTracking.countDocuments(query);

    res.status(200).json({
      success: true,
      data: returns,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get returns error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch returns'
    });
  }
});

// @route   GET /api/dealer/returns/:id
// @desc    Get return details
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const returnItem = await DocketTracking.findById(req.params.id).lean();

    if (!returnItem) {
      return res.status(404).json({
        success: false,
        message: 'Return not found'
      });
    }

    res.status(200).json({
      success: true,
      data: returnItem
    });
  } catch (error) {
    console.error('Get return details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch return details'
    });
  }
});

// @route   POST /api/dealer/returns/create
// @desc    Create new return request
// @access  Private
router.post('/create', async (req, res) => {
  try {
    const {
      invoiceNumber,
      reason,
      items,
      courierName,
      description
    } = req.body;

    // Validate invoice exists
    const invoice = await Invoice.findOne({ invoiceNumber });
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Generate docket number
    const count = await DocketTracking.countDocuments();
    const docketNumber = `RTN-2026-${String(count + 1).padStart(3, '0')}`;

    // Create return docket
    const returnDocket = new DocketTracking({
      docketNumber,
      invoiceNumber,
      courierName: courierName || 'Delhivery',
      currentStatus: 'Pending',
      returnType: reason,
      description,
      timeline: [
        {
          status: 'Return raised',
          timestamp: new Date(),
          location: 'Dealer Location',
          remarks: `Return request created - Reason: ${reason}`
        }
      ],
      estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      items
    });

    await returnDocket.save();

    res.status(201).json({
      success: true,
      message: 'Return request created successfully',
      data: returnDocket
    });
  } catch (error) {
    console.error('Create return error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create return request'
    });
  }
});

// @route   GET /api/dealer/returns/:id/track
// @desc    Track return
// @access  Private
router.get('/:id/track', async (req, res) => {
  try {
    const returnItem = await DocketTracking.findById(req.params.id)
      .select('docketNumber currentStatus timeline estimatedDelivery courierName')
      .lean();

    if (!returnItem) {
      return res.status(404).json({
        success: false,
        message: 'Return not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        docketNumber: returnItem.docketNumber,
        status: returnItem.currentStatus,
        timeline: returnItem.timeline,
        estimatedDelivery: returnItem.estimatedDelivery,
        courier: returnItem.courierName
      }
    });
  } catch (error) {
    console.error('Track return error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track return'
    });
  }
});

export default router;
