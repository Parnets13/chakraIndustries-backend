import SalesOrder from '../models/SalesOrder.js';
import CorporateClient from '../models/CorporateClient.js';
import ItemMaster from '../models/ItemMaster.js';
import InventoryItem from '../models/InventoryItem.js';

const genOrderId = async () => {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;
  const last = await SalesOrder.findOne({ orderId: new RegExp(`^${prefix}`) }).sort({ orderId: -1 });
  if (!last) return `${prefix}001`;
  const num = parseInt(last.orderId.split('-')[2]) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
};

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
const normalizeGstin = (gstin = '') => String(gstin).toUpperCase().replace(/\s/g, '');

const getDealerDiscountPercentage = async (dealer) => {
  if (!dealer) return 0;
  const mobile = normalizeMobile(dealer.mobile);
  const gst = normalizeGstin(dealer.gstin || '');
  let client = null;
  if (gst) client = await CorporateClient.findOne({ gstNumber: gst }).select('discountPercentage');
  if (!client && mobile) client = await CorporateClient.findOne({ phone: mobile }).select('discountPercentage');
  if (!client) {
    const name = (dealer.businessName || dealer.name || '').trim();
    if (name) client = await CorporateClient.findOne({ name: { $regex: `^${name}$`, $options: 'i' } }).select('discountPercentage');
  }
  const disc = Number(client?.discountPercentage || 0);
  return Number.isFinite(disc) ? disc : 0;
};

const belongsToDealer = (order, dealer) => {
  const dealerCustomer = dealer.businessName || dealer.name;
  const matchesCustomerId =
    dealer.erpClientId && order.customerId && String(order.customerId) === String(dealer.erpClientId);
  const matchesCustomerName = dealerCustomer && String(order.customer || '').trim() === String(dealerCustomer).trim();
  return matchesCustomerId || matchesCustomerName;
};

const toDealerOrderSummary = (order) => ({
  mongodbId: order._id,
  id: order.orderId,
  customer: order.customer,
  status: order.status,
  priority: order.priority,
  totalItems: order.items,
  amount: `₹${Number(order.value || 0).toLocaleString('en-IN')}`,
  createdAt: order.createdAt,
});

const findDealerOrder = async (idOrOrderId, dealer) => {
  const isObjectId = /^[a-fA-F0-9]{24}$/.test(String(idOrOrderId));
  const query = isObjectId ? { _id: idOrOrderId } : { orderId: idOrOrderId };
  const order = await SalesOrder.findOne(query);
  if (!order) return null;
  if (!belongsToDealer(order, dealer)) return 'forbidden';
  return order;
};

export const getDealerOrders = async (req, res) => {
  try {
    const { status, search } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const dealerCustomer = req.dealer.businessName || req.dealer.name;
    const baseOr = [];
    if (req.dealer.erpClientId) baseOr.push({ customerId: req.dealer.erpClientId });
    if (dealerCustomer) baseOr.push({ customer: dealerCustomer });

    const filter = baseOr.length ? { $or: baseOr } : {};

    if (status && status !== 'All') {
      if (status === 'In Transit') filter.status = { $in: ['Shipped'] };
      else if (status === 'Pending') filter.status = { $in: ['Pending', 'Processing'] };
      else filter.status = status;
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

    const orders = await SalesOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
    res.json({ success: true, data: orders.map(toDealerOrderSummary) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch orders' });
  }
};

export const getDealerOrderById = async (req, res) => {
  try {
    const order = await findDealerOrder(req.params.id, req.dealer);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order === 'forbidden') return res.status(403).json({ success: false, message: 'Not allowed' });
    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch order' });
  }
};

export const createDealerOrder = async (req, res) => {
  try {
    console.log('Creating dealer order, req.body:', req.body);
    const itemsInput = parseItems(req.body.items);
    if (itemsInput.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }

    const productIds = itemsInput.map((i) => i.productId);
    const products = await ItemMaster.find({ _id: { $in: productIds } }).populate('category', 'name');
    console.log('Found products:', products);
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const discountPercentage = await getDealerDiscountPercentage(req.dealer);

    // Get stock for all SKUs
    const skus = products.map(p => p.sku);
    const stockAgg = await InventoryItem.aggregate([
      { $match: { sku: { $in: skus } } },
      { $group: { _id: '$sku', qty: { $sum: { $ifNull: ['$qty', 0] } } } }
    ]);
    const stockMap = new Map(stockAgg.map(row => [row._id, row.qty || 0]));

    const lineItems = [];
    let totalQty = 0;
    let subTotal = 0;
    let totalGst = 0;
    let totalValue = 0;

    for (const item of itemsInput) {
      const product = byId.get(String(item.productId));
      if (!product) {
        return res.status(400).json({ success: false, message: `Product ${item.productId} not found` });
      }

      // Check stock
      const stock = stockMap.get(product.sku) || 0;
      if (stock < item.quantity) {
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient stock for ${product.name}. Available: ${stock}, Requested: ${item.quantity}` 
        });
      }

      const basePrice = product.sellingPrice || product.unitPrice || 0;
      const unitPrice = Math.max(0, +(basePrice - (basePrice * discountPercentage) / 100).toFixed(2));
      const gstPercent = product.gst || 0;
      const itemSubTotal = unitPrice * item.quantity;
      const itemGstAmount = (itemSubTotal * gstPercent) / 100;
      const itemTotal = itemSubTotal + itemGstAmount;

      subTotal += itemSubTotal;
      totalGst += itemGstAmount;
      totalQty += item.quantity;
      totalValue += itemTotal;

      lineItems.push({
        productId: product._id,
        sku: product.sku,
        name: product.name,
        quantity: item.quantity,
        unitPrice,
        gstPercent,
        gstAmount: +itemGstAmount.toFixed(2),
        total: +itemTotal.toFixed(2),
      });
    }

    if (lineItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid products in order' });
    }

    const orderId = await genOrderId();
    const dealerCustomer = req.dealer.businessName || req.dealer.name;

    const order = await SalesOrder.create({
      orderId,
      customer: dealerCustomer,
      customerId: req.dealer.erpClientId,
      items: totalQty,
      value: +totalValue.toFixed(2),
      subTotal: +subTotal.toFixed(2),
      totalGst: +totalGst.toFixed(2),
      priority: req.body.priority || 'Normal',
      status: 'Pending',
      orderDate: new Date(),
      remarks: req.body.notes || 'Order from dealer app',
      dealerId: req.dealer._id,
      source: 'DealerApp',
      deliveryAddress: req.body.deliveryAddress || '',
      notes: req.body.notes || '',
      lineItems,
      statusHistory: [{ status: 'Pending', note: 'Order placed from dealer app' }],
    });

    console.log('Order created successfully:', orderId);
    res.status(201).json({ 
      success: true, 
      data: { 
        orderId: order.orderId, 
        mongodbId: order._id,
        subTotal: order.subTotal,
        totalGst: order.totalGst,
        totalValue: order.value
      } 
    });
  } catch (error) {
    console.error('Create dealer order error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create order' });
  }
};

export const cancelDealerOrder = async (req, res) => {
  try {
    const order = await findDealerOrder(req.params.id, req.dealer);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order === 'forbidden') return res.status(403).json({ success: false, message: 'Not allowed' });

    if (order.status === 'Delivered') {
      return res.status(400).json({ success: false, message: 'Delivered orders cannot be cancelled' });
    }

    order.status = 'Cancelled';
    order.cancelReason = req.body.reason || '';
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({ status: 'Cancelled', note: order.cancelReason || 'Cancelled by dealer' });
    await order.save();

    res.json({ success: true, data: toDealerOrderSummary(order) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Failed to cancel order' });
  }
};

export const trackDealerOrder = async (req, res) => {
  try {
    const order = await findDealerOrder(req.params.id, req.dealer);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order === 'forbidden') return res.status(403).json({ success: false, message: 'Not allowed' });

    const history = Array.isArray(order.statusHistory) && order.statusHistory.length
      ? order.statusHistory
      : [{ status: order.status, at: order.updatedAt || order.createdAt, note: '' }];

    res.json({
      success: true,
      data: {
        orderId: order.orderId,
        status: order.status,
        history,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to track order' });
  }
};

export const repeatDealerOrder = async (req, res) => {
  try {
    const prev = await findDealerOrder(req.params.id, req.dealer);
    if (!prev) return res.status(404).json({ success: false, message: 'Order not found' });
    if (prev === 'forbidden') return res.status(403).json({ success: false, message: 'Not allowed' });

    const orderId = await genOrderId();
    const dealerCustomer = req.dealer.businessName || req.dealer.name;

    const lineItems = Array.isArray(prev.lineItems) ? prev.lineItems.map((i) => ({
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.total,
    })) : [];

    const totalQty = lineItems.reduce((s, i) => s + (i.quantity || 0), 0);
    const totalValue = lineItems.reduce((s, i) => s + (i.total || 0), 0);

    const order = await SalesOrder.create({
      orderId,
      customer: dealerCustomer,
      customerId: req.dealer.erpClientId,
      items: totalQty,
      value: totalValue,
      priority: prev.priority || 'Normal',
      status: 'Pending',
      orderDate: new Date(),
      remarks: 'Repeat order from dealer app',
      dealerId: req.dealer._id,
      source: 'DealerApp',
      deliveryAddress: prev.deliveryAddress || '',
      notes: 'Repeat order from dealer app',
      lineItems,
      statusHistory: [{ status: 'Pending', note: `Repeat of ${prev.orderId}` }],
    });

    res.status(201).json({ success: true, data: { orderId: order.orderId, mongodbId: order._id } });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Failed to repeat order' });
  }
};
