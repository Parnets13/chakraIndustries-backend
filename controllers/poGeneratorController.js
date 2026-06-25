import PurchaseOrder from '../models/PurchaseOrder.js';
import Inventory from '../models/Inventory.js';
import POInvoice from '../models/POInvoice.js';
import PendingOrder from '../models/PendingOrder.js';
import AccountsPayable from '../models/AccountsPayable.js';
import Vendor from '../models/Vendor.js';
import Company from '../models/Company.js';

// ── Find or create a Company by buyer name ────────────────────────────────────
// Matches by exact name OR any stored alias (case-insensitive)
const findOrCreateCompany = async (buyerName, buyerGSTIN = '') => {
  if (!buyerName || !buyerName.trim()) return null;
  const name = buyerName.trim();
  // Try exact match first, then alias match
  let company = await Company.findOne({
    $or: [
      { companyName: { $regex: `^${name}$`, $options: 'i' } },
      { aliases:     { $regex: `^${name}$`, $options: 'i' } },
    ],
  });
  if (!company) {
    company = await Company.create({
      companyName: name,
      gstNumber:   buyerGSTIN || '',
      aliases:     [],
    });
  } else if (buyerGSTIN && !company.gstNumber) {
    company.gstNumber = buyerGSTIN;
    await company.save();
  }
  return company;
};

// ── ID generator ──────────────────────────────────────────────────────────────
const genInvoiceNo = async () => {
  const year = new Date().getFullYear();
  const prefix = `POINV-${year}-`;
  const last = await POInvoice.findOne({ invoiceNo: new RegExp(`^${prefix}`) })
    .sort({ createdAt: -1 });
  if (!last) return `${prefix}0001`;
  const parts = last.invoiceNo.split('-');
  const num = parseInt(parts[parts.length - 1]) || 0;
  return `${prefix}${String(num + 1).padStart(4, '0')}`;
};

// ── GET /api/po-generator/pos ─────────────────────────────────────────────────
// List all POs available for invoicing (Approved or Received)
export const listPOs = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $in: ['Approved', 'Received', 'Pending', 'Draft'] };
    }
    if (search) {
      filter.$or = [
        { poId: { $regex: search, $options: 'i' } },
      ];
    }
    const pos = await PurchaseOrder.find(filter)
      .populate('vendor', 'companyName contactPerson phone email')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: pos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/po-generator/stock-check/:poId ───────────────────────────────────
// For each item in the PO, find matching inventory by name (case-insensitive)
// Returns per-item: requestedQty, availableQty, status (Ready / Low Stock / Out of Stock)
export const stockCheck = async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.poId)
      .populate('vendor', 'companyName contactPerson phone email');
    if (!po) return res.status(404).json({ success: false, message: 'PO not found' });

    // For each PO item, sum availableQuantity across all inventory records matching by name
    const itemResults = await Promise.all(
      (po.items || []).map(async (item) => {
        const inventoryRecords = await Inventory.find({
          name: { $regex: new RegExp(item.name.trim(), 'i') },
        });

        const totalAvailable = inventoryRecords.reduce(
          (sum, inv) => sum + (inv.availableQuantity || 0), 0
        );

        let stockStatus = 'Ready';
        if (totalAvailable === 0) stockStatus = 'Out of Stock';
        else if (totalAvailable < item.qty) stockStatus = 'Low Stock';

        const dispatchableQty = Math.min(totalAvailable, item.qty);
        const pendingQty = item.qty - dispatchableQty;

        return {
          itemName:       item.name,
          requestedQty:   item.qty,
          availableQty:   totalAvailable,
          dispatchableQty,
          pendingQty,
          unit:           item.unit,
          basePrice:      item.basePrice,
          gst:            item.gst,
          stockStatus,
          canFullFill:    totalAvailable >= item.qty,
        };
      })
    );

    const canFullInvoice = itemResults.every(i => i.canFullFill);
    const hasAnyStock    = itemResults.some(i => i.availableQty > 0);

    res.json({
      success: true,
      data: {
        po: {
          _id:         po._id,
          poId:        po.poId,
          status:      po.status,
          vendor:      po.vendor,
          grandTotal:  po.grandTotal,
          deliveryDate: po.deliveryDate,
          createdAt:   po.createdAt,
        },
        items:          itemResults,
        canFullInvoice,
        hasAnyStock,
        summary: {
          totalItems:     itemResults.length,
          readyItems:     itemResults.filter(i => i.stockStatus === 'Ready').length,
          lowStockItems:  itemResults.filter(i => i.stockStatus === 'Low Stock').length,
          outOfStockItems:itemResults.filter(i => i.stockStatus === 'Out of Stock').length,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/po-generator/generate-invoice ───────────────────────────────────
// Accept or reject partial invoice generation
// Body: { poId, action: 'accept'|'reject', items: [{ itemName, invoicedQty, pendingQty, ... }] }
export const generateInvoice = async (req, res) => {
  try {
    const { poId, action, items = [], notes = '' } = req.body;

    if (!poId) return res.status(400).json({ success: false, message: 'poId is required' });
    if (!['accept', 'reject'].includes(action))
      return res.status(400).json({ success: false, message: 'action must be accept or reject' });

    const po = await PurchaseOrder.findById(poId).populate('vendor', 'companyName');
    if (!po) return res.status(404).json({ success: false, message: 'PO not found' });

    if (action === 'reject') {
      return res.json({
        success: true,
        message: 'Invoice generation rejected. PO remains pending.',
        data: { action: 'rejected', poId: po.poId },
      });
    }

    // action === 'accept' — generate partial invoice
    if (!items.length)
      return res.status(400).json({ success: false, message: 'No items provided for invoice' });

    const invoiceNo = await genInvoiceNo();

    // Build invoice items — only items with invoicedQty > 0
    const invoiceItems = items
      .filter(it => (it.invoicedQty || 0) > 0)
      .map(it => {
        const lineTotal = (it.invoicedQty || 0) * (it.basePrice || 0) * (1 + (it.gst || 18) / 100);
        return {
          itemName:     it.itemName,
          requestedQty: it.requestedQty,
          availableQty: it.availableQty,
          invoicedQty:  it.invoicedQty,
          pendingQty:   it.pendingQty,
          unit:         it.unit || 'Nos',
          basePrice:    it.basePrice || 0,
          gst:          it.gst || 18,
          lineTotal:    +lineTotal.toFixed(2),
        };
      });

    if (!invoiceItems.length)
      return res.status(400).json({ success: false, message: 'No items with invoiceable quantity' });

    const subtotal   = invoiceItems.reduce((s, it) => s + (it.invoicedQty * it.basePrice), 0);
    const gstTotal   = invoiceItems.reduce((s, it) => s + (it.invoicedQty * it.basePrice * it.gst / 100), 0);
    const grandTotal = subtotal + gstTotal;

    const isPartial = items.some(it => (it.pendingQty || 0) > 0);

    const invoice = await POInvoice.create({
      invoiceNo,
      poId:       po._id,
      poRef:      po.poId,
      vendorName: po.vendor?.companyName || '',
      items:      invoiceItems,
      subtotal:   +subtotal.toFixed(2),
      gstTotal:   +gstTotal.toFixed(2),
      grandTotal: +grandTotal.toFixed(2),
      invoiceType: isPartial ? 'partial' : 'full',
      status:     'Draft',
      notes,
    });

    // Save pending orders for items with remaining qty
    const pendingItems = items.filter(it => (it.pendingQty || 0) > 0);
    const pendingDocs = pendingItems.map(it => ({
      poId:         po._id,
      poRef:        po.poId,
      poInvoiceId:  invoice._id,
      vendorName:   po.vendor?.companyName || '',
      itemName:     it.itemName,
      requestedQty: it.requestedQty,
      invoicedQty:  it.invoicedQty,
      pendingQty:   it.pendingQty,
      unit:         it.unit || 'Nos',
      basePrice:    it.basePrice || 0,
      status:       'Pending',
      notes,
    }));

    if (pendingDocs.length) {
      await PendingOrder.insertMany(pendingDocs);
    }

    res.status(201).json({
      success: true,
      message: `Invoice ${invoiceNo} generated successfully${isPartial ? ' (Partial)' : ''}`,
      data: {
        invoice,
        pendingCount: pendingDocs.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/po-generator/generate-invoice-from-pdf ─────────────────────────
// Creates invoice directly from PDF-parsed data (no PO in DB required)
export const generateInvoiceFromPDF = async (req, res) => {
  try {
    const { poNumber, vendorName, buyerName, buyerAddress = '', buyerGSTIN = '', shipToName = '', shipToAddress = '', items = [], total, notes = '', companyId: explicitCompanyId } = req.body;

    if (!items.length)
      return res.status(400).json({ success: false, message: 'No items provided' });

    const invoiceNo = await genInvoiceNo();

    const invoiceItems = items.map(it => {
      const cleanHsn = (value) => {
        const digits = String(value || '').replace(/\D/g, '');
        return digits.length >= 4 && digits.length <= 10 ? digits : '';
      };
      let itemName = it.name || it.itemName || 'Item';
      let hsn = cleanHsn(it.hsn);
      if (!hsn) {
        const hsnInName = itemName.match(/(?:\/\s*)?(\d(?:[\s-]?\d){3,9})\s*$/);
        if (hsnInName) hsn = cleanHsn(hsnInName[1]);
      }
      if (hsn) {
        itemName = itemName.replace(/\s*\/?\s*\d(?:[\s-]?\d){3,9}\s*$/, '').trim();
      }
      const qty       = it.qty || 1;
      const rate      = it.rate || it.basePrice || 0;
      // IMPORTANT: use 0 as default, never fall back to 18 — if the PDF has no tax, gst must be 0
      const gst       = (it.gst != null && it.gst !== '') ? Number(it.gst) : 0;
      const disc      = it.discount || 0;
      const cgst      = Number(it.cgst) || 0;
      const sgst      = Number(it.sgst) || 0;
      const igst      = Number(it.igst) || 0;
      const taxable   = it.taxableValue || +(qty * rate * (1 - disc / 100)).toFixed(2);
      // Use the lineAmount sent from frontend (which is the PDF's actual line total).
      // Only fall back to computing from gst% if lineAmount is not provided.
      const lineTotal = (it.lineAmount != null && parseFloat(it.lineAmount) > 0)
        ? +parseFloat(it.lineAmount).toFixed(2)
        : +(taxable * (1 + gst / 100)).toFixed(2);

      return {
        itemName,
        requestedQty: qty,
        availableQty: qty,
        invoicedQty:  qty,
        pendingQty:   0,
        unit:         it.unit || 'Nos',
        basePrice:    rate,
        gst,
        cgst,
        sgst,
        igst,
        cgstVal:      it.cgstVal || 0,
        sgstVal:      it.sgstVal || 0,
        igstVal:      it.igstVal || 0,
        discount:     disc,
        taxableValue: taxable,
        lineTotal,
        hsn,
      };
    });

    // Compute grandTotal from actual line items — most reliable
    let grandTotal, subtotal, gstTotal;
    // Only use PDF-parsed total as a sanity check, not as the source of truth
    subtotal   = +(invoiceItems.reduce((s, it) => s + it.invoicedQty * it.basePrice * (1 - (it.discount || 0) / 100), 0)).toFixed(2);
    const cgstTotal = +(invoiceItems.reduce((s, it) => s + (it.cgstVal || 0), 0)).toFixed(2);
    const sgstTotal = +(invoiceItems.reduce((s, it) => s + (it.sgstVal || 0), 0)).toFixed(2);
    const igstTotal = +(invoiceItems.reduce((s, it) => s + (it.igstVal || 0), 0)).toFixed(2);
    gstTotal   = +(cgstTotal + sgstTotal + igstTotal).toFixed(2);

    // If tax vals are all 0 but gst% is set, compute from percentage
    if (gstTotal === 0) {
      gstTotal = +(invoiceItems.reduce((s, it) => s + it.invoicedQty * it.basePrice * (it.gst || 0) / 100, 0)).toFixed(2);
    }

    grandTotal = +(subtotal + gstTotal).toFixed(2);

    // Sanity: if PDF total is provided and reasonably close (within 5%), use it
    const pdfTotal = total ? parseFloat(total) : 0;
    if (pdfTotal > 100 && Math.abs(pdfTotal - grandTotal) / grandTotal < 0.05) {
      grandTotal = +pdfTotal.toFixed(2);
    }

    // ── Auto-detect / create company from buyerName (or use explicit companyId) ─
    let company;
    if (explicitCompanyId) {
      company = await Company.findById(explicitCompanyId);
    }
    if (!company) {
      company = await findOrCreateCompany(buyerName, buyerGSTIN);
    }

    const invoice = await POInvoice.create({
      invoiceNo,
      companyId:   company?._id   || null,
      companyName: company?.companyName || buyerName || '',
      poId:        null,
      poRef:       poNumber || 'PDF-UPLOAD',
      vendorName:  vendorName || '',
      buyerName:   buyerName || '',
      buyerAddress: buyerAddress,
      buyerGSTIN:  buyerGSTIN,
      items:      invoiceItems,
      subtotal,
      gstTotal,
      grandTotal,
      invoiceType: 'full',
      status:     'Draft',
      notes,
    });

    res.status(201).json({
      success: true,
      message: `Invoice ${invoiceNo} created — ₹${grandTotal.toLocaleString('en-IN')}`,
      data: { invoice },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
export const listInvoices = async (req, res) => {
  try {
    const { status, search, prefix, companyId } = req.query;
    const filter = {};
    if (status)    filter.status    = status;
    if (companyId) filter.companyId = companyId;
    if (prefix)    filter.invoiceNo = { $regex: `^${prefix}`, $options: 'i' };
    if (search) {
      filter.$or = [
        { invoiceNo:   { $regex: search, $options: 'i' } },
        { poRef:       { $regex: search, $options: 'i' } },
        { vendorName:  { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } },
      ];
    }
    const invoices = await POInvoice.find(filter)
      .populate('poId',      'poId status vendor')
      .populate('companyId', 'companyName gstNumber')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: invoices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/po-generator/invoices/:id ───────────────────────────────────────
export const getInvoiceById = async (req, res) => {
  try {
    const invoice = await POInvoice.findById(req.params.id)
      .populate('poId', 'poId status vendor deliveryDate paymentTerms');
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/po-generator/invoices/:id/status ───────────────────────────────
export const updateInvoiceStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const invoice = await POInvoice.findByIdAndUpdate(
      req.params.id, { status }, { new: true }
    ).populate('poId');
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    // When status is set to Approved, automatically create an AccountsPayable entry if it doesn't exist
    if (status === 'Approved') {
      const existingAP = await AccountsPayable.findOne({ invoiceNumber: invoice.invoiceNo });
      if (!existingAP) {
        let vendorId = invoice.poId?.vendor || null;
        // If we don't have a vendor from poId, try to find by vendorName
        if (!vendorId && invoice.vendorName) {
          const vendor = await Vendor.findOne({ companyName: invoice.vendorName });
          vendorId = vendor?._id || null;
        }
        await AccountsPayable.create({
          supplier: vendorId,
          purchaseOrder: invoice.poId?._id || null,
          poInvoice: invoice._id,
          invoiceNumber: invoice.invoiceNo,
          invoiceDate: invoice.createdAt,
          dueDate: invoice.poId?.deliveryDate || null,
          invoiceAmount: invoice.grandTotal,
          paidAmount: 0,
          balanceAmount: invoice.grandTotal,
          paymentStatus: 'Unpaid'
        });
      }
    }

    res.json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/po-generator/pending-orders ─────────────────────────────────────
export const listPendingOrders = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (status) filter.status = status;
    else filter.status = 'Pending';
    if (search) {
      filter.$or = [
        { poRef:      { $regex: search, $options: 'i' } },
        { itemName:   { $regex: search, $options: 'i' } },
        { vendorName: { $regex: search, $options: 'i' } },
      ];
    }
    const orders = await PendingOrder.find(filter)
      .populate('poId', 'poId status')
      .populate('poInvoiceId', 'invoiceNo')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/po-generator/pending-orders/:id ───────────────────────────────
export const updatePendingOrder = async (req, res) => {
  try {
    const order = await PendingOrder.findByIdAndUpdate(
      req.params.id, req.body, { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Pending order not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/po-generator/invoices/:id/delivery ────────────────────────────
// Update delivery status for each item in the invoice
// Body: { items: [{ itemId, deliveryStatus, deliveredQty, deliveryDate, deliveryNotes }] }
export const updateDelivery = async (req, res) => {
  try {
    const { items = [] } = req.body;
    const invoice = await POInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    // Update each item's delivery status
    for (const update of items) {
      const item = invoice.items.id(update.itemId);
      if (item) {
        item.deliveryStatus  = update.deliveryStatus  || item.deliveryStatus;
        item.deliveredQty    = update.deliveredQty    ?? item.deliveredQty;
        item.deliveryDate    = update.deliveryDate    ? new Date(update.deliveryDate) : item.deliveryDate;
        item.deliveryNotes   = update.deliveryNotes   ?? item.deliveryNotes;
      }
    }

    // Auto-compute invoice-level delivery status
    const allItems = invoice.items;
    const allDelivered     = allItems.every(it => it.deliveryStatus === 'Delivered');
    const noneDelivered    = allItems.every(it => it.deliveryStatus === 'Pending' || it.deliveryStatus === 'Not Delivered');
    const someNotDelivered = allItems.some(it => it.deliveryStatus === 'Not Delivered');

    if (allDelivered) {
      invoice.deliveryStatus      = 'Fully Delivered';
      invoice.deliveryCompletedAt = new Date();
    } else if (noneDelivered && someNotDelivered) {
      invoice.deliveryStatus = 'Pending';
    } else {
      invoice.deliveryStatus = 'Partially Delivered';
    }

    await invoice.save();
    res.json({ success: true, data: invoice, message: 'Delivery status updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/po-generator/invoices/:id ─────────────────────────────────────
export const deleteInvoice = async (req, res) => {
  try {
    const invoice = await POInvoice.findByIdAndDelete(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    // Also delete related pending orders
    await PendingOrder.deleteMany({ poInvoiceId: req.params.id });
    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/po-generator/pos/:id ─────────────────────────────────────────
export const deletePO = async (req, res) => {
  try {
    const po = await PurchaseOrder.findByIdAndDelete(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    res.json({ success: true, message: 'Purchase Order deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
// ── POST /api/po-generator/migrate-hsn ───────────────────────────────────────
// One-time migration: extract HSN codes embedded in itemName and store them
// in the dedicated hsn field. Safe to run multiple times (idempotent).
export const migrateHSN = async (req, res) => {
  try {
    const invoices = await POInvoice.find({});
    const HSN_IN_NAME = /(?:\/\s*)?(\d{6,10})\s*$/;
    let updatedInvoices = 0;
    let updatedItems = 0;

    for (const inv of invoices) {
      let changed = false;
      for (const item of inv.items) {
        // Only fix items where hsn is empty but name contains an HSN
        if (!item.hsn || !item.hsn.trim()) {
          const m = item.itemName.match(HSN_IN_NAME);
          if (m) {
            item.hsn = m[1];
            item.itemName = item.itemName.replace(/\s*\/?\s*\d{6,10}\s*$/, '').trim();
            changed = true;
            updatedItems++;
          }
        }
      }
      if (changed) {
        await inv.save();
        updatedInvoices++;
      }
    }

    res.json({
      success: true,
      message: `Migration complete — updated ${updatedItems} items across ${updatedInvoices} invoices`,
      updatedInvoices,
      updatedItems,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/po-generator/upload-summary ─────────────────────────────────────
// Day-wise view of uploaded PO PDFs and the invoices created from them.
export const getUploadSummary = async (req, res) => {
  try {
    const { date } = req.query;
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '')
      ? date
      : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    const timezone = 'Asia/Kolkata';
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);

    const pdfUploadFilter = {
      poId: null,
      $or: [
        { notes: { $regex: 'Created from PDF', $options: 'i' } },
        { poRef: { $ne: '' } },
      ],
    };

    const [dailyRows, selectedInvoices] = await Promise.all([
      POInvoice.aggregate([
        { $match: { ...pdfUploadFilter, createdAt: { $gte: from } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone } },
            uploadedPOs: { $sum: 1 },
            invoiceCount: { $sum: 1 },
            totalValue: { $sum: '$grandTotal' },
            itemCount: { $sum: { $size: { $ifNull: ['$items', []] } } },
          },
        },
        { $sort: { _id: -1 } },
      ]),
      POInvoice.aggregate([
        {
          $match: {
            ...pdfUploadFilter,
            $expr: {
              $eq: [
                { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone } },
                selectedDate,
              ],
            },
          },
        },
        {
          $project: {
            invoiceNo: 1,
            poRef: 1,
            vendorName: 1,
            buyerName: 1,
            companyId: 1,
            companyName: 1,
            status: 1,
            grandTotal: 1,
            createdAt: 1,
            itemCount: { $size: { $ifNull: ['$items', []] } },
          },
        },
        { $sort: { createdAt: -1 } },
      ]),
    ]);

    const daily = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-CA', { timeZone: timezone });
      const row = dailyRows.find(x => x._id === key) || {};
      daily.push({
        date: key,
        label: new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        uploadedPOs: row.uploadedPOs || 0,
        invoiceCount: row.invoiceCount || 0,
        totalValue: row.totalValue || 0,
        itemCount: row.itemCount || 0,
      });
    }

    res.json({
      success: true,
      data: {
        selectedDate,
        daily,
        selected: {
          uploadedPOs: selectedInvoices.length,
          invoiceCount: selectedInvoices.length,
          totalValue: selectedInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0),
          itemCount: selectedInvoices.reduce((sum, inv) => sum + (inv.itemCount || 0), 0),
          invoices: selectedInvoices,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getStats = async (req, res) => {
  try {
    const [
      totalInvoices, draftInvoices, approvedInvoices, paidInvoices,
      totalPending, fulfilledPending,
      partialInvoices, fullInvoices,
      totalPOs,
    ] = await Promise.all([
      POInvoice.countDocuments(),
      POInvoice.countDocuments({ status: 'Draft' }),
      POInvoice.countDocuments({ status: 'Approved' }),
      POInvoice.countDocuments({ status: 'Paid' }),
      PendingOrder.countDocuments({ status: 'Pending' }),
      PendingOrder.countDocuments({ status: 'Fulfilled' }),
      POInvoice.countDocuments({ invoiceType: 'partial' }),
      POInvoice.countDocuments({ invoiceType: 'full' }),
      PurchaseOrder.countDocuments(),
    ]);

    const valueAgg = await POInvoice.aggregate([
      { $group: { _id: null, total: { $sum: '$grandTotal' } } },
    ]);

    // ── Last 7 days daily trend ──────────────────────────────────────────────
    const days = 7;
    const now  = new Date();
    const from = new Date(now); from.setDate(from.getDate() - (days - 1)); from.setHours(0,0,0,0);

    const [invoiceTrend, poTrend] = await Promise.all([
      POInvoice.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count:   { $sum: 1 },
          partial: { $sum: { $cond: [{ $eq: ['$invoiceType', 'partial'] }, 1, 0] } },
          full:    { $sum: { $cond: [{ $eq: ['$invoiceType', 'full'] }, 1, 0] } },
          value:   { $sum: '$grandTotal' },
        }},
        { $sort: { _id: 1 } },
      ]),
      PurchaseOrder.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: {
          _id:   { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Fill all 7 days (even if 0)
    const trend = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from); d.setDate(d.getDate() + i);
      const key = d.toISOString().split('T')[0];
      const inv = invoiceTrend.find(x => x._id === key) || {};
      const po  = poTrend.find(x => x._id === key)      || {};
      trend.push({
        date:     key,
        label:    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        invoices: inv.count   || 0,
        partial:  inv.partial || 0,
        full:     inv.full    || 0,
        value:    inv.value   || 0,
        pos:      po.count    || 0,
      });
    }

    res.json({
      success: true,
      data: {
        totalInvoices, draftInvoices, approvedInvoices, paidInvoices,
        totalPending, fulfilledPending,
        partialInvoices, fullInvoices,
        totalValue: valueAgg[0]?.total || 0,
        totalPOs,
        trend,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Company CRUD ──────────────────────────────────────────────────────────────

// GET /api/po-generator/companies
export const listCompanies = async (req, res) => {
  try {
    const companies = await Company.find().sort({ companyName: 1 });
    res.json({ success: true, data: companies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/po-generator/companies
export const createCompany = async (req, res) => {
  try {
    const { companyName, gstNumber, address, email, phone, aliases } = req.body;
    if (!companyName?.trim())
      return res.status(400).json({ success: false, message: 'companyName is required' });
    const company = await Company.create({ companyName: companyName.trim(), gstNumber, address, email, phone, aliases: aliases || [] });
    res.status(201).json({ success: true, data: company });
  } catch (err) {
    if (err.code === 11000)
      return res.status(400).json({ success: false, message: 'Company already exists' });
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/po-generator/companies/:id
export const updateCompany = async (req, res) => {
  try {
    const company = await Company.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    res.json({ success: true, data: company });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/po-generator/companies/:id
export const deleteCompany = async (req, res) => {
  try {
    const company = await Company.findByIdAndDelete(req.params.id);
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    res.json({ success: true, message: 'Company deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
