import OEMInvoice from '../models/OEMInvoice.js';
import OEMOrder from '../models/OEMOrder.js';
import BrandOrder from '../models/BrandOrder.js';

// Generate unique Invoice Number
const generateInvoiceNumber = async () => {
  const count = await OEMInvoice.countDocuments();
  const year = new Date().getFullYear();
  return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
};

// Create Invoice from OEM Order
export const createInvoice = async (req, res) => {
  try {
    const { oemOrderId, unitPrice, taxRate, paymentTerms, notes } = req.body;

    // Verify OEM order exists
    const oemOrder = await OEMOrder.findById(oemOrderId).populate('brandOrderId');
    if (!oemOrder) {
      return res.status(404).json({ success: false, message: 'OEM order not found' });
    }

    const brandOrder = oemOrder.brandOrderId;

    // Calculate amounts
    const subtotal = unitPrice * oemOrder.quantity;
    const taxAmount = (subtotal * (taxRate || 18)) / 100;
    const totalAmount = subtotal + taxAmount;

    const invoiceNumber = await generateInvoiceNumber();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30); // 30 days payment terms

    const invoice = new OEMInvoice({
      invoiceNumber,
      oemOrderId,
      brandOrderId: brandOrder._id,
      corporateClientId: brandOrder.corporateClientId,
      product: oemOrder.product,
      quantity: oemOrder.quantity,
      unit: oemOrder.unit,
      unitPrice,
      subtotal,
      taxRate: taxRate || 18,
      taxAmount,
      totalAmount,
      dueDate,
      paymentTerms,
      notes,
      createdBy: req.user?.id
    });

    await invoice.save();

    // Update OEM order
    await OEMOrder.findByIdAndUpdate(oemOrderId, {
      billingStatus: 'Invoiced',
      invoiceNumber,
      invoiceDate: new Date(),
      invoiceAmount: totalAmount,
      status: 'Invoiced'
    });

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: invoice
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all Invoices
export const getInvoices = async (req, res) => {
  try {
    const { paymentStatus, oemOrderId, corporateClientId } = req.query;
    const filter = {};

    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (oemOrderId) filter.oemOrderId = oemOrderId;
    if (corporateClientId) filter.corporateClientId = corporateClientId;

    const invoices = await OEMInvoice.find(filter)
      .populate('oemOrderId', 'oemOrderId product quantity')
      .populate('brandOrderId', 'brandOrderId product')
      .populate('corporateClientId', 'name email')
      .populate('createdBy', 'name email')
      .sort({ invoiceDate: -1 });

    res.json({ success: true, data: invoices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Invoice by ID
export const getInvoiceById = async (req, res) => {
  try {
    const invoice = await OEMInvoice.findById(req.params.id)
      .populate('oemOrderId')
      .populate('brandOrderId')
      .populate('corporateClientId')
      .populate('createdBy', 'name email');

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    res.json({ success: true, data: invoice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Record Payment
export const recordPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amountPaid, paymentMethod, paymentDate } = req.body;

    const invoice = await OEMInvoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const totalPaid = invoice.amountPaid + amountPaid;
    let paymentStatus = 'Partial';

    if (totalPaid >= invoice.totalAmount) {
      paymentStatus = 'Paid';
    }

    const updatedInvoice = await OEMInvoice.findByIdAndUpdate(
      id,
      {
        amountPaid: totalPaid,
        paymentStatus,
        paymentMethod,
        paymentDate: paymentDate || new Date()
      },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Payment recorded successfully',
      data: updatedInvoice
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Sync Invoice to Tally
export const syncToTally = async (req, res) => {
  try {
    const { id } = req.params;
    const { tallyDocumentId } = req.body;

    const invoice = await OEMInvoice.findByIdAndUpdate(
      id,
      {
        tallyDocumentId,
        tallyStatus: 'Synced'
      },
      { new: true }
    );

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Update OEM order
    await OEMOrder.findByIdAndUpdate(invoice.oemOrderId, {
      tallyStatus: 'Synced',
      tallyDocumentId,
      status: 'Tally-Synced'
    });

    res.json({
      success: true,
      message: 'Invoice synced to Tally successfully',
      data: invoice
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Invoice Summary
export const getInvoiceSummary = async (req, res) => {
  try {
    const summary = {
      totalInvoices: await OEMInvoice.countDocuments(),
      byPaymentStatus: await OEMInvoice.aggregate([
        { $group: { _id: '$paymentStatus', count: { $sum: 1 } } }
      ]),
      totalRevenue: await OEMInvoice.aggregate([
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      totalPaid: await OEMInvoice.aggregate([
        { $group: { _id: null, total: { $sum: '$amountPaid' } } }
      ]),
      tallySync: await OEMInvoice.aggregate([
        { $group: { _id: '$tallyStatus', count: { $sum: 1 } } }
      ])
    };

    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
