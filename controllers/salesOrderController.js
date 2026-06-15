import SalesOrder from '../models/SalesOrder.js';
import Invoice from '../models/Invoice.js';
import { genOrderId } from '../utils/orderIdGenerator.js';

export const getAllOrders = async (req, res) => {
  try {
    const { status, search, source } = req.query;
    const filter = {};
    if (status && status !== 'All') filter.status = status;
    if (source) filter.source = source;
    if (search) filter.$or = [
      { orderId: { $regex: search, $options: 'i' } },
      { customer: { $regex: search, $options: 'i' } },
    ];
    let orders = await SalesOrder.find(filter).sort({ createdAt: -1 });
    
    // Get invoices for all orders
    const orderIds = orders.map(o => o._id);
    const invoices = await Invoice.find({ salesOrderId: { $in: orderIds } });
    const invoiceMap = {};
    invoices.forEach(inv => {
      invoiceMap[inv.salesOrderId.toString()] = inv;
    });
    
    // Attach invoices to orders
    orders = orders.map(order => {
      const orderObj = order.toObject();
      orderObj.invoice = invoiceMap[order._id.toString()] || null;
      return orderObj;
    });
    
    res.json({ success: true, data: orders });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

export const getOrderStats = async (req, res) => {
  try {
    const [total, pending, processing, shipped, delivered, cancelled] = await Promise.all([
      SalesOrder.countDocuments(),
      SalesOrder.countDocuments({ status: 'Pending' }),
      SalesOrder.countDocuments({ status: 'Processing' }),
      SalesOrder.countDocuments({ status: 'Shipped' }),
      SalesOrder.countDocuments({ status: 'Delivered' }),
      SalesOrder.countDocuments({ status: 'Cancelled' }),
    ]);
    res.json({ success: true, data: { total, pending, processing, shipped, delivered, cancelled } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

export const getOrderById = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

export const createOrder = async (req, res) => {
  const maxRetries = 3;
  let attempts = 0;
  
  // Get idempotency key from headers
  const idempotencyKey = req.headers['x-idempotency-key'];

  while (attempts < maxRetries) {
    try {
      const { customer, items, value, priority, status, orderDate, remarks, file, deliveryAddress, notes, expectedDeliveryDate } = req.body;
      if (!customer) return res.status(400).json({ success: false, message: 'Customer is required' });
      
      // Check for existing order with this idempotency key
      if (idempotencyKey) {
        const existingOrder = await SalesOrder.findOne({
          $or: [
            { createdBy: req.user?._id, 'metadata.idempotencyKey': idempotencyKey },
            { customer: customer, 'metadata.idempotencyKey': idempotencyKey }
          ]
        });

        if (existingOrder) {
          console.log('Returning existing order for idempotency key:', idempotencyKey);
          return res.status(200).json({
            success: true,
            message: 'Order already placed (idempotent)',
            data: existingOrder
          });
        }
      }

      const orderId = await genOrderId();
      
      // items must always be an array in the new schema
      const orderItems = Array.isArray(items) ? items : [];
      const itemCount  = orderItems.length;

      const order = await SalesOrder.create({
        orderId, customer,
        items: orderItems,
        itemCount,
        value: parseFloat(String(value).replace(/[^0-9.]/g, '')) || 0,
        priority: priority || 'Normal',
        status: status || 'Pending',
        orderDate: orderDate ? new Date(orderDate) : new Date(),
        remarks: remarks || '',
        file: file || '',
        deliveryAddress: deliveryAddress || '',
        notes: notes || '',
        expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : null,
        createdBy: req.user?._id,
        metadata: {
          idempotencyKey: idempotencyKey || undefined
        }
      });
      res.status(201).json({ success: true, data: order });
      return;
    } catch (e) {
      console.error('Create sales order error:', e);
      // Duplicate orderId (very rare race) — retry
      if (e.code === 11000 && e.keyPattern?.orderId) {
        attempts++;
        if (attempts >= maxRetries) {
          console.error('Max retries reached for order ID collision');
          return res.status(409).json({ success: false, message: 'Order ID collision — please try again' });
        }
        // Wait a short time before retrying
        await new Promise(resolve => setTimeout(resolve, 100 * attempts));
      } else {
        res.status(400).json({ success: false, message: e.message });
        return;
      }
    }
  }
};

export const updateOrder = async (req, res) => {
  try {
    const { customer, items, value, priority, status, remarks, file, deliveryAddress, notes, expectedDeliveryDate } = req.body;
    const update = {};
    if (customer !== undefined) update.customer = customer;
    
    if (items !== undefined) {
      update.items     = Array.isArray(items) ? items : [];
      update.itemCount = update.items.length;
    }

    if (value !== undefined) update.value = parseFloat(String(value).replace(/[^0-9.]/g, '')) || 0;
    if (priority !== undefined) update.priority = priority;
    if (status !== undefined) update.status = status;
    if (remarks !== undefined) update.remarks = remarks;
    if (file !== undefined) update.file = file;
    if (deliveryAddress !== undefined) update.deliveryAddress = deliveryAddress;
    if (notes !== undefined) update.notes = notes;
    if (expectedDeliveryDate !== undefined) update.expectedDeliveryDate = expectedDeliveryDate;

    const order = await SalesOrder.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

export const deleteOrder = async (req, res) => {
  try {
    const order = await SalesOrder.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    
    // Also delete any linked invoice
    await Invoice.deleteMany({ salesOrderId: order._id });
    
    res.json({ success: true, message: 'Order deleted' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
