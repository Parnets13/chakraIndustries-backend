import express from 'express';
import Invoice from '../../models/Invoice.js';
import SalesOrder from '../../models/SalesOrder.js';
import { protectDealer } from '../../middleware/dealerAuthMiddleware.js';

const router = express.Router();

// Helper function to get dealer's sales order IDs
const getDealerSalesOrderIds = async (dealer) => {
  const dealerCustomer = dealer.businessName || dealer.name;
  const baseOr = [];
  if (dealer.erpClientId)  baseOr.push({ customerId: dealer.erpClientId });
  if (dealerCustomer)      baseOr.push({ customer: { $regex: dealerCustomer, $options: 'i' } });
  if (dealer._id)          baseOr.push({ dealerId: dealer._id });
  if (baseOr.length === 0) return [];
  const orders = await SalesOrder.find({ $or: baseOr }, { _id: 1 });
  return orders.map(o => o._id);
};

// Helper: build the full invoice match query for a dealer
const buildDealerInvoiceQuery = async (dealer) => {
  const salesOrderIds = await getDealerSalesOrderIds(dealer);
  const orClauses = [{ dealerId: dealer._id }];
  if (salesOrderIds.length) orClauses.push({ salesOrderId: { $in: salesOrderIds } });
  if (dealer.businessName)  orClauses.push({ partyName: { $regex: dealer.businessName, $options: 'i' } });
  if (dealer.name)          orClauses.push({ partyName: { $regex: dealer.name, $options: 'i' } });
  return { $or: orClauses };
};

// @route   GET /api/dealer/invoices
// @desc    Get invoices for this dealer
// @access  Private
router.get('/', protectDealer, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    const query = await buildDealerInvoiceQuery(req.dealer);

    if (status && status !== 'All') {
      query.paymentStatus = status === 'Paid' ? 'Paid'
        : status === 'Overdue' ? undefined : undefined;
      if (status === 'Paid')    query.paymentStatus = 'Paid';
      else if (status === 'Overdue') query.status = 'Overdue';
      else if (status === 'Pending') {
        query.$and = query.$and || [];
        query.$and.push({ paymentStatus: { $ne: 'Paid' } });
      }
    }

    if (search) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { invoiceNo:        { $regex: search, $options: 'i' } },
          { partyName:        { $regex: search, $options: 'i' } },
          { purchaseOrderRef: { $regex: search, $options: 'i' } },
          { uniqueId:         { $regex: search, $options: 'i' } },
          { vendorInvoiceNumber: { $regex: search, $options: 'i' } },
          // Match by order ID stored in items description or notes
          { notes:            { $regex: search, $options: 'i' } },
          // Match by product name inside items array
          { 'items.description': { $regex: search, $options: 'i' } },
        ],
      });
    }

    // Extra: if orderId param provided separately, also filter by salesOrderId or purchaseOrderRef
    const { orderId, productName } = req.query;
    if (orderId) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { purchaseOrderRef:    { $regex: orderId, $options: 'i' } },
          { uniqueId:            { $regex: orderId, $options: 'i' } },
          { vendorInvoiceNumber: { $regex: orderId, $options: 'i' } },
          { notes:               { $regex: orderId, $options: 'i' } },
        ],
      });
    }
    if (productName) {
      query.$and = query.$and || [];
      query.$and.push({
        'items.description': { $regex: productName, $options: 'i' },
      });
    }

    const [invoices, total] = await Promise.all([
      Invoice.find(query).sort({ invoiceDate: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Invoice.countDocuments(query),
    ]);

    console.log(`[dealer/invoices] dealer=${req.dealer.businessName || req.dealer.name}, found=${invoices.length}`);

    const transformedInvoices = invoices.map(inv => {
      const grand     = inv.grandTotal || 0;
      const paid      = inv.paidAmount || 0;
      const remaining = inv.remainingAmount != null ? inv.remainingAmount : Math.max(0, grand - paid);

      const payStatus = inv.paymentStatus === 'Paid' ? 'Paid'
        : inv.status === 'Overdue'         ? 'Overdue'
        : inv.paymentStatus === 'Partial'  ? 'Partial'
        : 'Pending';

      const statusColor = payStatus === 'Paid'    ? '#1D9E75'
        : payStatus === 'Overdue'                 ? '#C62828'
        : payStatus === 'Partial'                 ? '#1976D2'
        : '#BA7517';

      return {
        id:          inv._id,
        invoiceNo:   inv.invoiceNo,
        date:        inv.invoiceDate
          ? new Date(inv.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          : '',
        dueDate:     inv.dueDate
          ? new Date(inv.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          : '',
        grandTotal:  grand,
        paidAmount:  paid,
        remaining,
        amount:      `₹${grand.toLocaleString('en-IN')}`,
        remainingFmt:`₹${remaining.toLocaleString('en-IN')}`,
        status:      payStatus,
        statusColor,
        paymentStatus: payStatus,
        orderNo:     inv.purchaseOrderRef || '',
        partyName:   inv.partyName || '',
        itemCount:   (inv.items || []).length,
        // Include items array so frontend can show product name from invoice
        items:       (inv.items || []).map(it => ({
          description: it.description || '',
          qty:         it.qty || 0,
          rate:        it.rate || 0,
          unit:        it.unit || '',
          total:       it.total || 0,
        })),
        source:      inv.source || 'manual',
      };
    });

    res.status(200).json({
      success: true,
      data: transformedInvoices,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch invoices' });
  }
});

// @route   GET /api/dealer/invoices/:id
// @desc    Get invoice by ID
// @access  Private
router.get('/:id', protectDealer, async (req, res) => {
  try {
    const baseQuery = await buildDealerInvoiceQuery(req.dealer);
    const invoice = await Invoice.findOne({ _id: req.params.id, ...baseQuery }).lean();
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch invoice' });
  }
});

// @route   GET /api/dealer/invoices/:id/download
// @desc    Download invoice (simulated)
// @access  Private
router.get('/:id/download', protectDealer, async (req, res) => {
  try {
    const baseQuery = await buildDealerInvoiceQuery(req.dealer);
    const invoice = await Invoice.findOne({ _id: req.params.id, ...baseQuery }).lean();
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    res.status(200).json({
      success: true,
      message: 'Invoice download simulated',
      data: { invoiceNo: invoice.invoiceNo, downloadUrl: null },
    });
  } catch (error) {
    console.error('Download invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to download invoice' });
  }
});

// @route   POST /api/dealer/invoices/:id/pay
// @desc    Pay invoice
// @access  Private
router.post('/:id/pay', protectDealer, async (req, res) => {
  try {
    const baseQuery = await buildDealerInvoiceQuery(req.dealer);
    const invoice = await Invoice.findOne({ _id: req.params.id, ...baseQuery });
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    invoice.paidAmount    = invoice.grandTotal;
    invoice.paymentStatus = 'Paid';
    invoice.status        = 'Paid';
    await invoice.save();
    res.status(200).json({ success: true, message: 'Payment successful' });
  } catch (error) {
    console.error('Pay invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to process payment' });
  }
});

export default router;
