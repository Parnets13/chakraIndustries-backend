import SalesOrder from '../models/SalesOrder.js';

const genOrderId = async () => {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;
  const last = await SalesOrder.findOne({ orderId: new RegExp(`^${prefix}`) }).sort({ orderId: -1 });
  if (!last) return `${prefix}001`;
  const num = parseInt(last.orderId.split('-')[2]) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
};

export const getAllOrders = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (status && status !== 'All') filter.status = status;
    if (search) filter.$or = [
      { orderId: { $regex: search, $options: 'i' } },
      { customer: { $regex: search, $options: 'i' } },
    ];
    const orders = await SalesOrder.find(filter).sort({ createdAt: -1 });
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
  try {
    const { customer, items, value, priority, status, orderDate, remarks, file, deliveryAddress, notes, expectedDeliveryDate } = req.body;
    if (!customer) return res.status(400).json({ success: false, message: 'Customer is required' });
    const orderId = await genOrderId();
    
    // items can be a number (from legacy) or an array (from dealer/new UI)
    const isArray = Array.isArray(items);
    const orderItems = isArray ? items : [];
    const itemCount = isArray ? items.length : (parseInt(items) || 0);

    const order = await SalesOrder.create({
      orderId, customer,
      items: orderItems,
      itemCount: itemCount,
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
    });
    res.status(201).json({ success: true, data: order });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

export const updateOrder = async (req, res) => {
  try {
    const { customer, items, value, priority, status, remarks, file, deliveryAddress, notes, expectedDeliveryDate } = req.body;
    const update = {};
    if (customer !== undefined) update.customer = customer;
    
    if (items !== undefined) {
      const isArray = Array.isArray(items);
      update.items = isArray ? items : [];
      update.itemCount = isArray ? items.length : (parseInt(items) || 0);
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
    res.json({ success: true, message: 'Order deleted' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
