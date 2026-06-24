import express from 'express';
import Invoice from '../../models/Invoice.js';
import SalesOrder from '../../models/SalesOrder.js';
import { protectDealer } from '../../middleware/dealerAuthMiddleware.js';

const router = express.Router();

// Helper function to get dealer's sales order IDs
const getDealerSalesOrderIds = async (dealer) => {
  const dealerCustomer = dealer.businessName || dealer.name;
  const baseOr = [];
  if (dealer.erpClientId) baseOr.push({ customerId: dealer.erpClientId });
  if (dealerCustomer) baseOr.push({ customer: dealerCustomer });
  if (dealer._id) baseOr.push({ dealerId: dealer._id });
  
  if (baseOr.length === 0) return [];
  
  const orders = await SalesOrder.find({ $or: baseOr }, { _id: 1 });
  return orders.map(o => o._id);
};

// @route   GET /api/dealer/invoices
// @desc    Get invoices
// @access  Private
router.get('/', protectDealer, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Get dealer's sales order IDs
    const dealerSalesOrderIds = await getDealerSalesOrderIds(req.dealer);

    // Build query - invoices where dealerId matches OR salesOrderId is in dealer's orders
    const query = {
      $or: [
        { dealerId: req.dealer._id },
        { salesOrderId: { $in: dealerSalesOrderIds } }
      ]
    };
    
    if (status && status !== 'All') {
      query.status = status;
    }

    if (search) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { invoiceNo: { $regex: search, $options: 'i' } },
          { partyName: { $regex: search, $options: 'i' } },
          { purchaseOrderRef: { $regex: search, $options: 'i' } }
        ]
      });
    }

    const invoices = await Invoice.find(query)
      .sort({ invoiceDate: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Invoice.countDocuments(query);

    // Transform invoices
    const transformedInvoices = invoices.map(inv => ({
      id: inv._id,
      invoiceNo: inv.invoiceNo,
      date: inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
      amount: `₹${(inv.grandTotal || 0).toLocaleString('en-IN')}`,
      status: inv.paymentStatus === 'Paid' ? 'Paid' 
        : inv.paymentStatus === 'Partial' ? 'Pending'
        : inv.status === 'Overdue' ? 'Overdue' : 'Pending',
      statusColor: inv.paymentStatus === 'Paid' ? '#1D9E75'
        : inv.paymentStatus === 'Partial' ? '#BA7517'
        : inv.status === 'Overdue' ? '#C62828' : '#BA7517',
      dueDate: inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
      orderNo: inv.purchaseOrderRef || ''
    }));

    res.status(200).json({
      success: true,
      data: transformedInvoices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices'
    });
  }
});

// @route   GET /api/dealer/invoices/:id
// @desc    Get invoice by ID
// @access  Private
router.get('/:id', protectDealer, async (req, res) => {
  try {
    // Get dealer's sales order IDs first
    const dealerSalesOrderIds = await getDealerSalesOrderIds(req.dealer);

    const invoice = await Invoice.findOne({ 
      _id: req.params.id,
      $or: [
        { dealerId: req.dealer._id },
        { salesOrderId: { $in: dealerSalesOrderIds } }
      ]
    }).lean();

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice'
    });
  }
});

// @route   GET /api/dealer/invoices/:id/download
// @desc    Download invoice (simulated)
// @access  Private
router.get('/:id/download', protectDealer, async (req, res) => {
  try {
    // Get dealer's sales order IDs first
    const dealerSalesOrderIds = await getDealerSalesOrderIds(req.dealer);

    const invoice = await Invoice.findOne({ 
      _id: req.params.id,
      $or: [
        { dealerId: req.dealer._id },
        { salesOrderId: { $in: dealerSalesOrderIds } }
      ]
    }).lean();

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Invoice download simulated',
      data: {
        invoiceNo: invoice.invoiceNo,
        downloadUrl: null // In real implementation, this would be a PDF URL
      }
    });
  } catch (error) {
    console.error('Download invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download invoice'
    });
  }
});

// @route   POST /api/dealer/invoices/:id/pay
// @desc    Pay invoice (simulated)
// @access  Private
router.post('/:id/pay', protectDealer, async (req, res) => {
  try {
    // Get dealer's sales order IDs first
    const dealerSalesOrderIds = await getDealerSalesOrderIds(req.dealer);

    const invoice = await Invoice.findOne({ 
      _id: req.params.id,
      $or: [
        { dealerId: req.dealer._id },
        { salesOrderId: { $in: dealerSalesOrderIds } }
      ]
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Update invoice
    invoice.paidAmount = invoice.grandTotal;
    invoice.paymentStatus = 'Paid';
    invoice.status = 'Paid';
    await invoice.save();

    res.status(200).json({
      success: true,
      message: 'Payment successful'
    });
  } catch (error) {
    console.error('Pay invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment'
    });
  }
});

export default router;
