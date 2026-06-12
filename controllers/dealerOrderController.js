import SalesOrder from '../models/SalesOrder.js';
import CorporateClient from '../models/CorporateClient.js';
import ItemMaster from '../models/ItemMaster.js';
import InventoryItem from '../models/InventoryItem.js';
import Invoice from '../models/Invoice.js';
import mongoose from 'mongoose';
import { genOrderId } from '../utils/orderIdGenerator.js';

const parseItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => ({
      productId: i.productId,
      quantity: parseInt(i.quantity, 10) || 0,
    }))
    .filter((i) => i.productId && i.quantity > 0);
};

const normalizeMobile = (mobile = '') => String(mobile).replace(/\D/g, '').slice(-10);
const normalizeGstin  = (gstin = '')  => String(gstin).toUpperCase().replace(/\s/g, '');

const getDealerDiscountPercentage = async (dealer) => {
  if (!dealer) return 0;
  const mobile = normalizeMobile(dealer.mobile);
  const gst    = normalizeGstin(dealer.gstin || '');
  let client   = null;

  if (gst)    client = await CorporateClient.findOne({ gstNumber: gst }).select('discountPercentage');
  if (!client && mobile) client = await CorporateClient.findOne({ phone: mobile }).select('discountPercentage');
  if (!client) {
    const name = (dealer.businessName || dealer.name || '').trim();
    if (name)  client = await CorporateClient.findOne({ name: { $regex: `^${name}$`, $options: 'i' } }).select('discountPercentage');
  }

  const disc = Number(client?.discountPercentage || 0);
  return Number.isFinite(disc) ? disc : 0;
};

/**
 * Check whether a SalesOrder belongs to the authenticated dealer.
 * Matches on customerId (ObjectId) OR customer name (String).
 */
const belongsToDealer = (order, dealer) => {
  const dealerCustomer = dealer.businessName || dealer.name;
  const matchesCustomerId =
    dealer.erpClientId &&
    order.customerId &&
    String(order.customerId) === String(dealer.erpClientId);
  const matchesCustomerName =
    dealerCustomer &&
    String(order.customer || '').trim().toLowerCase() === String(dealerCustomer).trim().toLowerCase();
  const matchesDealerId =
    order.dealerId && String(order.dealerId) === String(dealer._id);

  return matchesCustomerId || matchesCustomerName || matchesDealerId;
};

const toDealerOrderSummary = (order) => ({
  mongodbId:   order._id,
  id:          order.orderId,
  customer:    order.customer,
  status:      order.status,
  priority:    order.priority || 'Normal',
  totalItems:  order.itemCount || (Array.isArray(order.lineItems) ? order.lineItems.length : 0),
  totalQty:    order.totalQuantity || 0,
  amount:      `₹${Number(order.value || 0).toLocaleString('en-IN')}`,
  value:       order.value || 0,
  subTotal:    order.subTotal || 0,
  totalGst:    order.totalGst || 0,
  source:      order.source || 'ERP',
  createdAt:   order.createdAt,
  orderDate:   order.orderDate,
  lineItems:   order.lineItems || [],
  statusHistory: order.statusHistory || [],
});

const findDealerOrder = async (idOrOrderId, dealer) => {
  const isObjectId = /^[a-fA-F0-9]{24}$/.test(String(idOrOrderId));
  const query = isObjectId ? { _id: idOrOrderId } : { orderId: idOrOrderId };
  const order = await SalesOrder.findOne(query);
  if (!order) return null;
  if (!belongsToDealer(order, dealer)) return 'forbidden';
  return order;
};

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * GET /api/dealer/orders
 * List all orders for the authenticated dealer, newest first.
 */
export const getDealerOrders = async (req, res) => {
  try {
    const { status, search } = req.query;
    const page  = Math.max(parseInt(req.query.page,  10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const skip  = (page - 1) * limit;

    const dealerCustomer = req.dealer.businessName || req.dealer.name;

    // Build a union filter: orders placed by this dealer (by clientId, name, or dealerId)
    const baseOr = [];
    if (req.dealer.erpClientId) baseOr.push({ customerId: req.dealer.erpClientId });
    if (dealerCustomer)         baseOr.push({ customer: dealerCustomer });
    if (req.dealer._id)         baseOr.push({ dealerId: req.dealer._id });

    const filter = baseOr.length ? { $or: baseOr } : {};

    if (status && status !== 'All') {
      // Map UI filter labels to actual DB status values
      if (status === 'In Transit') {
        filter.status = { $in: ['Shipped', 'In Transit'] };
      } else if (status === 'Pending') {
        filter.status = { $in: ['Pending', 'Processing'] };
      } else {
        filter.status = status;
      }
    }

    if (search) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { orderId: { $regex: search, $options: 'i' } },
          { customer: { $regex: search, $options: 'i' } },
        ],
      });
    }

    const [orders, total] = await Promise.all([
      SalesOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      SalesOrder.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: orders.map(toDealerOrderSummary),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('getDealerOrders error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch orders' });
  }
};

/**
 * GET /api/dealer/orders/:id
 * Get full details of a single order.
 */
export const getDealerOrderById = async (req, res) => {
  try {
    const order = await findDealerOrder(req.params.id, req.dealer);
    if (!order)         return res.status(404).json({ success: false, message: 'Order not found' });
    if (order === 'forbidden') return res.status(403).json({ success: false, message: 'Access denied' });

    res.json({ success: true, data: toDealerOrderSummary(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch order' });
  }
};

/**
 * POST /api/dealer/orders/create
 * Place a new order from the dealer app.
 *
 * Body: { items: [{ productId, quantity }], deliveryAddress?, notes?, priority? }
 */
export const createDealerOrder = async (req, res) => {
  const maxRetries = 3;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      console.log('=== createDealerOrder START ===');
      console.log('req.body:', JSON.stringify(req.body));
      console.log('dealer:', req.dealer?.name, req.dealer?._id);
      console.log(`Attempt ${attempts + 1} of ${maxRetries}`);

      const itemsInput = parseItems(req.body.items);
      if (itemsInput.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one valid item is required' });
      }

      // ── Fetch products ────────────────────────────────────────────────────────
      const productIds = itemsInput.map((i) => i.productId);
      const products   = await ItemMaster.find({ _id: { $in: productIds } }).populate('category', 'name');

      if (products.length === 0) {
        return res.status(400).json({ success: false, message: 'No valid products found for the given IDs' });
      }

      const byId = new Map(products.map((p) => [String(p._id), p]));

      // ── Stock check ───────────────────────────────────────────────────────────
      const skus = products.map((p) => p.sku);
      const stockAgg = await InventoryItem.aggregate([
        { $match: { sku: { $in: skus } } },
        { $group: { _id: '$sku', qty: { $sum: { $ifNull: ['$qty', 0] } } } },
      ]);
      const stockMap = new Map(stockAgg.map((row) => [row._id, row.qty || 0]));

      // ── Discount ──────────────────────────────────────────────────────────────
      const discountPercentage = await getDealerDiscountPercentage(req.dealer);

      // ── Build line items & totals ─────────────────────────────────────────────
      const lineItems = [];
      let totalQty   = 0;
      let subTotal   = 0;
      let totalGst   = 0;
      let totalValue = 0;

      for (const item of itemsInput) {
        const product = byId.get(String(item.productId));
        if (!product) {
          return res.status(400).json({ success: false, message: `Product ${item.productId} not found` });
        }

        const stock = stockMap.get(product.sku) || 0;
        if (stock < item.quantity) {
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for "${product.name}". Available: ${stock}, Requested: ${item.quantity}`,
          });
        }

        const basePrice      = product.sellingPrice || product.unitPrice || 0;
        const unitPrice      = Math.max(0, +(basePrice - (basePrice * discountPercentage) / 100).toFixed(2));
        const gstPercent     = product.gst || 0;
        const itemSubTotal   = +(unitPrice * item.quantity).toFixed(2);
        const itemGstAmount  = +((itemSubTotal * gstPercent) / 100).toFixed(2);
        const itemTotal      = +(itemSubTotal + itemGstAmount).toFixed(2);

        subTotal   += itemSubTotal;
        totalGst   += itemGstAmount;
        totalQty   += item.quantity;
        totalValue += itemTotal;

        lineItems.push({
          productId:  product._id,
          sku:        product.sku,
          name:       product.name,
          quantity:   item.quantity,
          unitPrice,
          gstPercent,
          gstAmount:  itemGstAmount,
          total:      itemTotal,
        });
      }

      // ── Create order ──────────────────────────────────────────────────────────
      const orderId        = await genOrderId();
      const dealerCustomer = req.dealer.businessName || req.dealer.name;

      const order = await SalesOrder.create({
        orderId,
        customer:        dealerCustomer,
        customerId:      req.dealer.erpClientId || undefined,
        dealerId:        req.dealer._id,
        source:          'DealerApp',
        status:          'Pending',
        priority:        req.body.priority || 'Normal',
        orderDate:       new Date(),
        deliveryAddress: req.body.deliveryAddress || '',
        notes:           req.body.notes || '',
        remarks:         `Order placed from dealer app by ${dealerCustomer}`,
        // Store totals
        itemCount:       lineItems.length,
        totalQuantity:   totalQty,
        subTotal:        +subTotal.toFixed(2),
        totalGst:        +totalGst.toFixed(2),
        value:           +totalValue.toFixed(2),
        // Dealer app items go in lineItems
        lineItems,
        // statusHistory for timeline tracking
        statusHistory: [
          {
            status: 'Pending',
            at:     new Date(),
            note:   `Order placed from dealer app by ${dealerCustomer}`,
          },
        ],
      });

      console.log('Order created:', order.orderId, order._id);

      res.status(201).json({
        success: true,
        message: 'Order placed successfully',
        data: {
          orderId:    order.orderId,
          mongodbId:  order._id,
          status:     order.status,
          itemCount:  order.itemCount,
          totalQty:   order.totalQuantity,
          subTotal:   order.subTotal,
          totalGst:   order.totalGst,
          totalValue: order.value,
          createdAt:  order.createdAt,
        },
      });
      return;
    } catch (error) {
      console.error('createDealerOrder error:', error);
      // Duplicate orderId (very rare race) — retry
      if (error.code === 11000 && error.keyPattern?.orderId) {
        attempts++;
        if (attempts >= maxRetries) {
          return res.status(409).json({ success: false, message: 'Order ID collision — please try again' });
        }
        // Wait a short time before retrying
        await new Promise(resolve => setTimeout(resolve, 100 * attempts));
      } else {
        res.status(400).json({ success: false, message: error.message || 'Failed to create order' });
        return;
      }
    }
  }
};

/**
 * POST /api/dealer/orders/:id/cancel
 */
export const cancelDealerOrder = async (req, res) => {
  try {
    const order = await findDealerOrder(req.params.id, req.dealer);
    if (!order)         return res.status(404).json({ success: false, message: 'Order not found' });
    if (order === 'forbidden') return res.status(403).json({ success: false, message: 'Access denied' });

    if (['Delivered', 'Cancelled'].includes(order.status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel an order with status "${order.status}"` });
    }

    order.status       = 'Cancelled';
    order.cancelReason = req.body.reason || 'Cancelled by dealer';
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status: 'Cancelled',
      at:     new Date(),
      note:   order.cancelReason,
    });
    await order.save();

    res.json({ success: true, data: toDealerOrderSummary(order) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Failed to cancel order' });
  }
};

/**
 * GET /api/dealer/orders/:id/track
 * Returns the full status timeline for an order.
 */
export const trackDealerOrder = async (req, res) => {
  try {
    const order = await findDealerOrder(req.params.id, req.dealer);
    if (!order)         return res.status(404).json({ success: false, message: 'Order not found' });
    if (order === 'forbidden') return res.status(403).json({ success: false, message: 'Access denied' });

    // Build history — use stored statusHistory or fall back to single entry
    const history = Array.isArray(order.statusHistory) && order.statusHistory.length
      ? order.statusHistory
      : [{ status: order.status, at: order.updatedAt || order.createdAt, note: '' }];

    // All possible stages in order
    const STAGES = ['Pending', 'Approved', 'Processing', 'Ready For Dispatch', 'Shipped', 'Delivered'];
    const currentIdx = STAGES.indexOf(order.status);

    const stages = STAGES.map((stage, idx) => {
      const historyEntry = history.find((h) => h.status === stage);
      return {
        stage,
        completed: idx < currentIdx || order.status === stage,
        active:    order.status === stage,
        at:        historyEntry?.at || null,
        note:      historyEntry?.note || '',
      };
    });

    res.json({
      success: true,
      data: {
        orderId:   order.orderId,
        mongodbId: order._id,
        status:    order.status,
        stages,
        history,
        lineItems: order.lineItems || [],
        value:     order.value,
        subTotal:  order.subTotal,
        totalGst:  order.totalGst,
        createdAt: order.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to track order' });
  }
};

/**
 * POST /api/dealer/orders/:id/repeat
 * Re-order the same items from a previous order (stock check skipped for now).
 */
export const repeatDealerOrder = async (req, res) => {
  const maxRetries = 3;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      const prev = await findDealerOrder(req.params.id, req.dealer);
      if (!prev)         return res.status(404).json({ success: false, message: 'Order not found' });
      if (prev === 'forbidden') return res.status(403).json({ success: false, message: 'Access denied' });

      if (!Array.isArray(prev.lineItems) || prev.lineItems.length === 0) {
        return res.status(400).json({ success: false, message: 'Original order has no line items to repeat' });
      }

      const orderId        = await genOrderId();
      const dealerCustomer = req.dealer.businessName || req.dealer.name;

      const lineItems    = prev.lineItems.map((i) => ({ ...i.toObject(), _id: undefined }));
      const totalQty     = lineItems.reduce((s, i) => s + (i.quantity || 0), 0);
      const subTotal     = lineItems.reduce((s, i) => s + (i.unitPrice * i.quantity || 0), 0);
      const totalGst     = lineItems.reduce((s, i) => s + (i.gstAmount || 0), 0);
      const totalValue   = lineItems.reduce((s, i) => s + (i.total || 0), 0);

      const order = await SalesOrder.create({
        orderId,
        customer:        dealerCustomer,
        customerId:      req.dealer.erpClientId || undefined,
        dealerId:        req.dealer._id,
        source:          'DealerApp',
        status:          'Pending',
        priority:        prev.priority || 'Normal',
        orderDate:       new Date(),
        deliveryAddress: prev.deliveryAddress || '',
        notes:           `Repeat of ${prev.orderId}`,
        remarks:         `Repeat order from dealer app (original: ${prev.orderId})`,
        itemCount:       lineItems.length,
        totalQuantity:   totalQty,
        subTotal:        +subTotal.toFixed(2),
        totalGst:        +totalGst.toFixed(2),
        value:           +totalValue.toFixed(2),
        lineItems,
        statusHistory: [
          { status: 'Pending', at: new Date(), note: `Repeat of ${prev.orderId}` },
        ],
      });

      res.status(201).json({
        success: true,
        message: 'Order repeated successfully',
        data: { orderId: order.orderId, mongodbId: order._id },
      });
      return;
    } catch (error) {
      // Duplicate orderId (very rare race) — retry
      if (error.code === 11000 && error.keyPattern?.orderId) {
        attempts++;
        if (attempts >= maxRetries) {
          return res.status(409).json({ success: false, message: 'Order ID collision — please try again' });
        }

        // Wait a short time before retrying
        await new Promise(resolve => setTimeout(resolve, 100 * attempts));
      } else {
        res.status(400).json({ success: false, message: error.message || 'Failed to repeat order' });
        return;
      }
    }
  }
};

/**
 * DELETE /api/dealer/orders/:id
 * Delete a pending or cancelled dealer order and its linked invoices.
 */
export const deleteDealerOrder = async (req, res) => {
  try {
    const order = await findDealerOrder(req.params.id, req.dealer);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order === 'forbidden') return res.status(403).json({ success: false, message: 'Access denied' });

    // Only allow deleting orders that are Pending or Cancelled
    if (!['Pending', 'Cancelled'].includes(order.status)) {
      return res.status(400).json({ success: false, message: `Cannot delete an order with status "${order.status}"` });
    }

    // Delete the order and any linked invoices
    await SalesOrder.findByIdAndDelete(order._id);
    await Invoice.deleteMany({ salesOrderId: order._id });

    res.json({ success: true, message: 'Order deleted successfully' });
  } catch (error) {
    console.error('deleteDealerOrder error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete order' });
  }
};
