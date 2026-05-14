import Invoice from '../models/Invoice.js';
import BulkOrder from '../models/BulkOrder.js';
import CorporateClient from '../models/CorporateClient.js';

const generateInvoiceNo = async () => {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await Invoice.findOne({ invoiceNo: new RegExp(`^${prefix}`) }).sort({ invoiceNo: -1 });
  if (!last) return `${prefix}001`;
  const num = parseInt(last.invoiceNo.split('-')[2]) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
};

// Auto-generate invoice when delivery is confirmed
export const generateInvoiceFromBulkOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const bulkOrder = await BulkOrder.findById(orderId);
    if (!bulkOrder) return res.status(404).json({ success: false, message: 'Order not found' });

    if (bulkOrder.invoiceId) {
      return res.status(400).json({ success: false, message: 'Invoice already generated for this order' });
    }

    // Get client details
    const client = await CorporateClient.findOne({ clientId: bulkOrder.clientId });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    // Generate invoice number
    const invoiceNo = await generateInvoiceNo();

    // Calculate GST (18% standard)
    const subtotal = bulkOrder.subtotal;
    const gst = Math.round(subtotal * 0.18);
    const grandTotal = subtotal + gst;

    // Create invoice
    const invoice = await Invoice.create({
      invoiceNo,
      partyName: client.name,
      partyGST: client.gstNumber,
      items: bulkOrder.items.map(item => ({
        description: item.itemName,
        sku: item.sku,
        qty: item.qty,
        rate: item.unitPrice,
        discount: item.discount,
        taxRate: 18,
        amount: item.total
      })),
      subtotal,
      totalDiscount: bulkOrder.items.reduce((sum, item) => sum + (item.qty * item.unitPrice * item.discount / 100), 0),
      totalTax: gst,
      grandTotal,
      status: 'Sent',
      source: 'bulk_order',
      referenceId: bulkOrder.orderId,
      createdBy: req.user?._id
    });

    // Update bulk order with invoice ID
    bulkOrder.invoiceId = invoice._id.toString();
    bulkOrder.status = 'Delivered';
    await bulkOrder.save();

    res.status(201).json({ success: true, data: invoice, message: 'Invoice generated successfully' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Get invoice for bulk order
export const getInvoiceForOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const bulkOrder = await BulkOrder.findById(orderId);
    if (!bulkOrder) return res.status(404).json({ success: false, message: 'Order not found' });

    if (!bulkOrder.invoiceId) {
      return res.status(404).json({ success: false, message: 'No invoice generated for this order' });
    }

    const invoice = await Invoice.findById(bulkOrder.invoiceId);
    res.json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update invoice status (Draft → Sent → Paid)
export const updateInvoiceStatus = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { status } = req.body;

    const invoice = await Invoice.findByIdAndUpdate(invoiceId, { status }, { new: true });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    res.json({ success: true, data: invoice, message: 'Invoice status updated' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Get all invoices for a corporate client
export const getClientInvoices = async (req, res) => {
  try {
    const { clientId } = req.params;
    const invoices = await Invoice.find({ 
      referenceId: { $regex: clientId } 
    }).sort({ createdAt: -1 });

    res.json({ success: true, data: invoices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
