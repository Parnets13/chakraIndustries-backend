import SalesOrder from '../models/SalesOrder.js';
import Inventory from '../models/Inventory.js';
import PickingList from '../models/PickingList.js';
import SortingJob from '../models/SortingJob.js';
import PackingJob from '../models/PackingJob.js';
import Invoice from '../models/Invoice.js';
import { genOrderId } from '../utils/orderIdGenerator.js';

// Get all dealer orders grouped by status
export const getDealerOrders = async (req, res) => {
  try {
    const { status, source, search, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    // By default show DealerApp orders; pass source=all to see everything
    if (source === 'all') {
      // no filter
    } else {
      filter.source = 'DealerApp';
    }
    if (status && status !== 'All') filter.status = status;
    if (search) {
      filter.$or = [
        { orderId:  { $regex: search, $options: 'i' } },
        { customer: { $regex: search, $options: 'i' } },
      ];
    }

    const [orders, total] = await Promise.all([
      SalesOrder.find(filter)
        .populate('dealerId', 'name businessName mobile email dealerCode')
        .populate('lineItems.productId', 'name sku')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      SalesOrder.countDocuments(filter),
    ]);

    // Enrich with invoice data
    const orderIds = orders.map(o => o._id);
    const invoices = await Invoice.find({ salesOrderId: { $in: orderIds } }).lean();
    const invMap   = new Map(invoices.map(i => [String(i.salesOrderId), i]));

    const data = orders.map(order => {
      const inv = invMap.get(String(order._id));
      return {
        ...order,
        invoice: inv || null,
        dealerName:    order.dealerId?.businessName || order.dealerId?.name || order.customer,
        dealerMobile:  order.dealerId?.mobile || '',
        dealerCode:    order.dealerId?.dealerCode || '',
        invoiceNo:     inv?.invoiceNo || null,
        invoiceStatus: inv ? 'Generated' : 'Pending',
        paymentStatus: inv?.paymentStatus || 'Unpaid',
        grandTotal:    inv?.grandTotal || order.value || 0,
        paidAmount:    inv?.paidAmount || 0,
      };
    });

    res.status(200).json({
      success: true,
      data,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('getDealerOrders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get single dealer order by ID
export const getDealerOrderById = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id)
      .populate('dealerId')
      .populate('createdBy');
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    console.error('getDealerOrderById error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Approve a dealer order
export const approveOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { approvedItems, remarks } = req.body;
    
    const order = await SalesOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    if (order.status !== 'Pending Approval') {
      return res.status(400).json({ success: false, message: 'Order is not in pending approval state' });
    }

    // Validate stock
    const itemsToCheck = approvedItems || (order.lineItems.length ? order.lineItems : order.items);
    for (const item of itemsToCheck) {
      const sku = item.sku || (item.productId ? (await item.productId)?.sku : null);
      if (!sku) continue;

      const inventory = await Inventory.find({ sku });
      const totalAvailable = inventory.reduce((sum, inv) => sum + inv.availableQuantity, 0);
      if (totalAvailable < (item.approvedQuantity || item.quantity)) {
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient stock for ${item.name || item.itemName}. Available: ${totalAvailable}, Requested: ${item.approvedQuantity || item.quantity}` 
        });
      }
    }

    // Update order
    order.status = 'Approved';
    order.remarks = remarks || order.remarks;
    if (approvedItems) {
      if (order.lineItems.length) {
        order.lineItems = order.lineItems.map(li => {
          const approved = approvedItems.find(ai => ai.productId?.toString() === li.productId?.toString());
          return { ...li.toObject(), approvedQuantity: approved?.approvedQuantity || li.quantity };
        });
      } else {
        order.items = order.items.map(i => {
          const approved = approvedItems.find(ai => ai.itemId?.toString() === i.itemId?.toString());
          return { ...i.toObject(), approvedQuantity: approved?.approvedQuantity || i.quantity };
        });
      }
    } else {
      if (order.lineItems.length) {
        order.lineItems = order.lineItems.map(li => ({ ...li.toObject(), approvedQuantity: li.quantity }));
      } else {
        order.items = order.items.map(i => ({ ...i.toObject(), approvedQuantity: i.quantity }));
      }
    }
    
    order.statusHistory.push({
      status: 'Approved',
      at: new Date(),
      note: remarks || 'Order approved',
      by: req.user._id
    });
    
    // Reserve stock
    const itemsToReserve = order.lineItems.length ? order.lineItems : order.items;
    for (const item of itemsToReserve) {
      const sku = item.sku;
      const qty = item.approvedQuantity || item.quantity;
      let remaining = qty;
      
      const inventories = await Inventory.find({ sku, availableQuantity: { $gt: 0 } }).sort({ createdDate: 1 });
      for (const inv of inventories) {
        if (remaining <= 0) break;
        const toReserve = Math.min(remaining, inv.availableQuantity);
        inv.reservedQuantity += toReserve;
        inv.availableQuantity -= toReserve;
        await inv.save();
        remaining -= toReserve;
      }
    }

    await order.save();
    
    // Auto generate picking list
    await generatePickingList(order);

    res.status(200).json({ success: true, data: order, message: 'Order approved successfully' });
  } catch (error) {
    console.error('approveOrder error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Reject a dealer order
export const rejectOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    
    const order = await SalesOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    if (order.status !== 'Pending Approval') {
      return res.status(400).json({ success: false, message: 'Order is not in pending approval state' });
    }
    
    order.status = 'Rejected';
    order.rejectionReason = rejectionReason;
    order.statusHistory.push({
      status: 'Rejected',
      at: new Date(),
      note: rejectionReason || 'Order rejected',
      by: req.user._id
    });
    
    await order.save();
    
    res.status(200).json({ success: true, data: order, message: 'Order rejected successfully' });
  } catch (error) {
    console.error('rejectOrder error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Generate picking list
const generatePickingList = async (order) => {
  try {
    const pickId = `PICK-${Date.now()}`;
    const items = [];
    
    const orderItems = order.lineItems.length ? order.lineItems : order.items;
    for (const item of orderItems) {
      const sku = item.sku;
      const qty = item.approvedQuantity || item.quantity;
      
      const inventory = await Inventory.findOne({ sku, availableQuantity: { $gt: 0 } }).populate('warehouse');
      if (inventory) {
        items.push({
          inventory: inventory._id,
          sku,
          itemName: item.name || item.itemName,
          quantity: qty,
          location: inventory.location ? `${inventory.location.zone || ''} ${inventory.location.rack || ''} ${inventory.location.shelf || ''} ${inventory.location.bin || ''}`.trim() : '',
          picked: false
        });
      }
    }
    
    await PickingList.create({
      pickId,
      orderId: order.orderId,
      salesOrderId: order._id,
      items,
      status: 'Pending'
    });
    
    // Update order status to Picking Started
    order.status = 'Picking Started';
    order.statusHistory.push({
      status: 'Picking Started',
      at: new Date(),
      note: 'Picking list generated, picking started',
      by: null
    });
    await order.save();
    
  } catch (error) {
    console.error('generatePickingList error:', error);
  }
};

// Update picking list
export const updatePickingList = async (req, res) => {
  try {
    const { id } = req.params;
    const { items, status, picker } = req.body;
    
    const pickingList = await PickingList.findById(id);
    if (!pickingList) {
      return res.status(404).json({ success: false, message: 'Picking list not found' });
    }
    
    if (items) pickingList.items = items;
    if (status) pickingList.status = status;
    if (picker) pickingList.picker = picker;
    
    await pickingList.save();
    
    // If picking is completed, move to Picking Completed then Sorting Started
    if (status === 'Completed') {
      const order = await SalesOrder.findOne({ orderId: pickingList.orderId });
      if (order) {
        order.status = 'Picking Completed';
        order.statusHistory.push({
          status: 'Picking Completed',
          at: new Date(),
          note: 'Picking completed',
          by: req.user._id
        });
        await order.save();
        
        // Create sorting job and update to Sorting Started
        await createSortingJob(order);
      }
    }
    
    res.status(200).json({ success: true, data: pickingList });
  } catch (error) {
    console.error('updatePickingList error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create sorting job
const createSortingJob = async (order) => {
  try {
    const sortingId = `SORT-${Date.now()}`;
    const orderItems = order.lineItems.length ? order.lineItems : order.items;
    
    for (const item of orderItems) {
      await SortingJob.create({
        sortingId,
        orderId: order.orderId,
        salesOrderId: order._id,
        sku: item.sku,
        itemName: item.name || item.itemName,
        quantity: item.approvedQuantity || item.quantity,
        status: 'Pending'
      });
    }
    
    order.status = 'Sorting Started';
    order.statusHistory.push({
      status: 'Sorting Started',
      at: new Date(),
      note: 'Sorting job created, sorting started',
      by: null
    });
    await order.save();
    
  } catch (error) {
    console.error('createSortingJob error:', error.message || error);
  }
};

// Update sorting job
export const updateSortingJob = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, grade } = req.body;
    
    const sortingJob = await SortingJob.findById(id);
    if (!sortingJob) {
      return res.status(404).json({ success: false, message: 'Sorting job not found' });
    }
    
    if (status) sortingJob.status = status;
    if (grade) sortingJob.grade = grade;
    
    await sortingJob.save();
    
    // Check if all sorting jobs for this order are completed
    const allSortingJobs = await SortingJob.find({ orderId: sortingJob.orderId });
    const allCompleted = allSortingJobs.every(j => j.status === 'Completed');
    if (allCompleted) {
      const order = await SalesOrder.findOne({ orderId: sortingJob.orderId });
      if (order) {
        order.status = 'Sorting Completed';
        order.statusHistory.push({
          status: 'Sorting Completed',
          at: new Date(),
          note: 'Sorting completed',
          by: req.user._id
        });
        await order.save();
        await createPackingJob(order);
      }
    }
    
    res.status(200).json({ success: true, data: sortingJob });
  } catch (error) {
    console.error('updateSortingJob error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create packing job
const createPackingJob = async (order) => {
  try {
    const packId = `PACK-${Date.now()}`;
    const orderItems = order.lineItems.length ? order.lineItems : order.items;
    const totalItems = orderItems.reduce((sum, i) => sum + (i.approvedQuantity || i.quantity), 0);
    
    await PackingJob.create({
      packId,
      orderId: order.orderId,
      salesOrderId: order._id,
      items: totalItems,
      status: 'Pending'
    });
    
    order.status = 'Packing Started';
    order.statusHistory.push({
      status: 'Packing Started',
      at: new Date(),
      note: 'Packing job created, packing started',
      by: null
    });
    await order.save();
    
  } catch (error) {
    console.error('createPackingJob error:', error);
  }
};

// Update packing job
export const updatePackingJob = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, weight, boxType } = req.body;
    
    const packingJob = await PackingJob.findById(id);
    if (!packingJob) {
      return res.status(404).json({ success: false, message: 'Packing job not found' });
    }
    
    if (status) packingJob.status = status;
    if (weight) packingJob.weight = weight;
    if (boxType) packingJob.boxType = boxType;
    
    await packingJob.save();
    
    if (status === 'Completed') {
      const order = await SalesOrder.findOne({ orderId: packingJob.orderId });
      if (order) {
        order.status = 'Packing Completed';
        order.statusHistory.push({
          status: 'Packing Completed',
          at: new Date(),
          note: 'Packing completed',
          by: req.user._id
        });
        await order.save();
      }
    }
    
    res.status(200).json({ success: true, data: packingJob });
  } catch (error) {
    console.error('updatePackingJob error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Generate invoice
export const generateInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await SalesOrder.findById(orderId).populate('dealerId');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    if (order.status !== 'Packing Completed') {
      return res.status(400).json({ success: false, message: 'Packing must be completed before generating invoice' });
    }
    
    // Generate invoice number
    const invoiceCount = await Invoice.countDocuments();
    const invoiceNo = `INV-${new Date().getFullYear()}-${String(invoiceCount + 1).padStart(6, '0')}`;
    
    const orderItems = order.lineItems.length ? order.lineItems : order.items;
    const items = orderItems.map(item => ({
      description: item.name || item.itemName,
      qty: item.approvedQuantity || item.quantity,
      rate: item.unitPrice || 0,
      taxRate: item.gstPercent || 0,
      basic: (item.approvedQuantity || item.quantity) * (item.unitPrice || 0),
      amount: (item.approvedQuantity || item.quantity) * (item.unitPrice || 0),
      taxAmount: ((item.approvedQuantity || item.quantity) * (item.unitPrice || 0) * (item.gstPercent || 0)) / 100,
      total: ((item.approvedQuantity || item.quantity) * (item.unitPrice || 0)) + (((item.approvedQuantity || item.quantity) * (item.unitPrice || 0) * (item.gstPercent || 0)) / 100)
    }));
    
    const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
    const totalTax = items.reduce((sum, i) => sum + i.taxAmount, 0);
    const grandTotal = subtotal + totalTax;
    
    const invoice = await Invoice.create({
      invoiceNo,
      invoiceDate: new Date(),
      dealerId: order.dealerId?._id,
      salesOrderId: order._id,
      partyName: order.dealerId?.businessName || order.dealerId?.name || order.customer,
      partyAddress: order.dealerId?.address || order.deliveryAddress,
      partyGST: order.dealerId?.gstin || '',
      partyEmail: order.dealerId?.email || '',
      partyPhone: order.dealerId?.mobile || '',
      shipToName: order.customer,
      shipToAddress: order.deliveryAddress,
      items,
      subtotal,
      totalTax,
      grandTotal,
      status: 'Sent',
      invoiceSource: 'sales_order'
    });
    
    order.status = 'Invoice Generated';
    order.statusHistory.push({
      status: 'Invoice Generated',
      at: new Date(),
      note: `Invoice ${invoiceNo} generated`,
      by: req.user._id
    });
    await order.save();
    
    res.status(200).json({ success: true, data: invoice, message: 'Invoice generated successfully' });
  } catch (error) {
    console.error('generateInvoice error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update dispatch info
export const updateDispatch = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, vehicleNumber, transportName, lrNumber } = req.body;
    
    const order = await SalesOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    if (status === 'Ready for Dispatch' && order.status !== 'Invoice Generated') {
      return res.status(400).json({ success: false, message: 'Invoice must be generated first' });
    }
    
    if (status) order.status = status;
    if (vehicleNumber) order.dispatchInfo.vehicleNumber = vehicleNumber;
    if (transportName) order.dispatchInfo.transportName = transportName;
    if (lrNumber) order.dispatchInfo.lrNumber = lrNumber;
    if (status === 'Dispatched') order.dispatchInfo.dispatchDate = new Date();
    
    order.statusHistory.push({
      status: status || order.status,
      at: new Date(),
      note: status === 'Dispatched' ? `Order dispatched via ${transportName || 'transport'}` : 'Dispatch status updated',
      by: req.user._id
    });
    
    // Update inventory when dispatched
    if (status === 'Dispatched') {
      const orderItems = order.lineItems.length ? order.lineItems : order.items;
      for (const item of orderItems) {
        const sku = item.sku;
        const qty = item.approvedQuantity || item.quantity;
        let remaining = qty;
        
        const inventories = await Inventory.find({ sku, reservedQuantity: { $gt: 0 } }).sort({ createdDate: 1 });
        for (const inv of inventories) {
          if (remaining <= 0) break;
          const toDispatch = Math.min(remaining, inv.reservedQuantity);
          inv.reservedQuantity -= toDispatch;
          inv.totalQuantity -= toDispatch;
          await inv.save();
          remaining -= toDispatch;
        }
      }
    }
    
    await order.save();
    
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    console.error('updateDispatch error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Mark order as delivered
export const markDelivered = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await SalesOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    if (order.status !== 'Dispatched') {
      return res.status(400).json({ success: false, message: 'Order must be dispatched first' });
    }
    
    order.status = 'Delivered';
    order.statusHistory.push({
      status: 'Delivered',
      at: new Date(),
      note: 'Order delivered',
      by: req.user._id
    });
    
    await order.save();
    
    res.status(200).json({ success: true, data: order, message: 'Order marked as delivered' });
  } catch (error) {
    console.error('markDelivered error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get dashboard stats
export const getDashboardStats = async (req, res) => {
  try {
    const totalOrders = await SalesOrder.countDocuments();
    const pendingApprovals = await SalesOrder.countDocuments({ status: 'Pending Approval' });
    const picking = await SalesOrder.countDocuments({ status: { $in: ['Picking Started', 'Picking Completed'] } });
    const sorting = await SalesOrder.countDocuments({ status: { $in: ['Sorting Started', 'Sorting Completed'] } });
    const packing = await SalesOrder.countDocuments({ status: { $in: ['Packing Started', 'Packing Completed'] } });
    const readyForDispatch = await SalesOrder.countDocuments({ status: 'Ready for Dispatch' });
    
    const totalInventory = await Inventory.aggregate([
      { $group: { _id: null, total: { $sum: '$totalQuantity' } } }
    ]);
    const availableStock = await Inventory.aggregate([
      { $group: { _id: null, total: { $sum: '$availableQuantity' } } }
    ]);
    const reservedStock = await Inventory.aggregate([
      { $group: { _id: null, total: { $sum: '$reservedQuantity' } } }
    ]);
    
    const lowStockProducts = await Inventory.find({ 
      $expr: { $lt: ['$availableQuantity', '$minQuantity'] } 
    });
    
    const recentOrders = await SalesOrder.find().sort({ createdAt: -1 }).limit(10);
    const recentInvoices = await Invoice.find().sort({ createdAt: -1 }).limit(10);
    
    res.status(200).json({
      success: true,
      data: {
        totalOrders,
        pendingApprovals,
        picking,
        sorting,
        packing,
        readyForDispatch,
        totalInventory: totalInventory[0]?.total || 0,
        availableStock: availableStock[0]?.total || 0,
        reservedStock: reservedStock[0]?.total || 0,
        lowStockProducts,
        recentOrders,
        recentInvoices
      }
    });
  } catch (error) {
    console.error('getDashboardStats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};