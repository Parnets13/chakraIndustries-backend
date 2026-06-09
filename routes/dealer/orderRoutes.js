import express from 'express';
import SalesOrder from '../../models/SalesOrder.js';
import InventoryItem from '../../models/InventoryItem.js';
import DocketTracking from '../../models/DocketTracking.js';

const router = express.Router();

// @route   GET /api/dealer/orders
// @desc    Get all orders for dealer
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    
    if (status && status !== 'All') {
      if (status === 'Pending') {
        query.status = { $in: ['Pending', 'Processing'] };
      } else if (status === 'In Transit') {
        query.status = { $in: ['In Transit', 'Shipped'] };
      } else if (status === 'Delivered') {
        query.status = 'Delivered';
      } else {
        query.status = status;
      }
    }

    if (search) {
      query.$or = [
        { orderId: { $regex: search, $options: 'i' } },
        { customer: { $regex: search, $options: 'i' } }
      ];
    }

    const orders = await SalesOrder.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await SalesOrder.countDocuments(query);

    // Get tracking info for each order
    const enrichedOrders = await Promise.all(
      orders.map(async (order) => {
        const tracking = await DocketTracking.findOne({ 
          salesOrderId: order._id 
        }).lean();

        // Safely handle items array
        const items = Array.isArray(order.items) ? order.items : [];
        const totalQty = items.reduce((sum, item) => sum + (item.quantity || 0), 0);

        // Calculate item count reliably
        let totalItems = 0;
        if (Array.isArray(order.items) && order.items.length > 0) {
          totalItems = order.items.length;
        } else if (order.itemCount) {
          totalItems = order.itemCount;
        } else if (typeof order.items === 'number') {
          totalItems = order.items;
        }

        return {
          id: order.orderId, 
          mongodbId: order._id.toString(),
          customer: order.customer,
          totalItems: totalItems,
          totalQty: totalQty || totalItems,
          amount: `₹${(order.value || 0).toLocaleString('en-IN')}`,
          status: order.status || 'Pending',
          expectedDelivery: order.expectedDeliveryDate ? new Date(order.expectedDeliveryDate).toLocaleDateString('en-GB') : null,
          trackingDetails: tracking ? {
            docketNumber: tracking.docketNumber,
            currentStatus: tracking.currentStatus,
            timeline: tracking.timeline
          } : null,
          createdAt: order.createdAt,
          file: order.file
        };
      })
    );

    res.status(200).json({
      success: true,
      data: enrichedOrders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    });
  }
});

// @route   GET /api/dealer/orders/:id
// @desc    Get order details
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const order = await SalesOrder.findOne({ 
      orderId: req.params.id 
    }).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Get tracking info
    const tracking = await DocketTracking.findOne({ 
      salesOrderId: order._id 
    }).lean();

    res.status(200).json({
      success: true,
      data: {
        ...order,
        tracking
      }
    });
  } catch (error) {
    console.error('Get order details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order details'
    });
  }
});

// @route   POST /api/dealer/orders/create
// @desc    Create new order from cart
// @access  Private
router.post('/create', async (req, res) => {
  try {
    const { items, deliveryAddress, notes } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order must contain at least one item'
      });
    }

    // Calculate total amount and validate stock
    let subTotal = 0;
    let totalGst = 0;
    let totalQuantity = 0;
    const orderItems = [];

    for (const item of items) {
      const inventoryItem = await InventoryItem.findById(item.productId);
      
      if (!inventoryItem) {
        return res.status(404).json({
          success: false,
          message: `Product ${item.productId} not found`
        });
      }

      if (inventoryItem.currentQuantity < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${inventoryItem.itemName}`
        });
      }

      const itemPrice = inventoryItem.unitPrice || 0;
      const itemGstPercent = inventoryItem.gst || 0;
      const itemSubTotal = itemPrice * item.quantity;
      const itemGstAmount = (itemSubTotal * itemGstPercent) / 100;
      const itemTotal = itemSubTotal + itemGstAmount;

      subTotal += itemSubTotal;
      totalGst += itemGstAmount;
      totalQuantity += item.quantity;

      orderItems.push({
        itemId: inventoryItem._id,
        itemName: inventoryItem.itemName,
        quantity: item.quantity,
        unitPrice: itemPrice,
        gstPercent: itemGstPercent,
        gstAmount: itemGstAmount,
        totalPrice: itemTotal
      });
    }

    // Generate order number (orderId) with 5 padding digits as per requirement
    const count = await SalesOrder.countDocuments();
    const orderId = `ORD-2026-${String(count + 1).padStart(5, '0')}`;

    // Create sales order
    const order = new SalesOrder({
      orderId,
      customer: req.user?.name || 'Dealer', 
      customerId: req.user?._id,
      items: orderItems,
      itemCount: orderItems.length,
      totalQuantity: totalQuantity,
      subTotal: subTotal,
      totalGst: totalGst,
      value: subTotal + totalGst,
      deliveryAddress,
      notes,
      status: 'Pending',
      expectedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });

    await order.save();

    // Update inventory
    for (const item of items) {
      await InventoryItem.findByIdAndUpdate(
        item.productId,
        { $inc: { currentQuantity: -item.quantity } }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: order
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order'
    });
  }
});

// @route   GET /api/dealer/orders/:id/track
// @desc    Track order
// @access  Private
router.get('/:id/track', async (req, res) => {
  try {
    const order = await SalesOrder.findOne({ 
      orderId: req.params.id 
    }).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const tracking = await DocketTracking.findOne({ 
      salesOrderId: order._id 
    }).lean();

    res.status(200).json({
      success: true,
      data: {
        orderId: order.orderId,
        status: order.status,
        tracking: tracking || null
      }
    });
  } catch (error) {
    console.error('Track order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track order'
    });
  }
});

// @route   POST /api/dealer/orders/:id/cancel
// @desc    Cancel order
// @access  Private
router.post('/:id/cancel', async (req, res) => {
  try {
    const { reason } = req.body;

    const order = await SalesOrder.findOne({ orderId: req.params.id });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.status === 'Delivered' || order.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel this order'
      });
    }

    // Restore inventory
    for (const item of order.items) {
      await InventoryItem.findByIdAndUpdate(
        item.itemId,
        { $inc: { currentQuantity: item.quantity } }
      );
    }

    order.status = 'Cancelled';
    order.cancellationReason = reason;
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel order'
    });
  }
});

export default router;
