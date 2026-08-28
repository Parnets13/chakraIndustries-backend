import StockInvoiceArchive from '../models/StockInvoiceArchive.js';
import Invoice from '../models/Invoice.js';

// ── GET /api/stock-invoice-archive ────────────────────────────────────────────
// Paginated listing of archived invoices. Supports search + status filter.
export const getAll = async (req, res) => {
  try {
    const { page = 1, limit = 25, search, status } = req.query;
    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 25));
    const skip     = (pageNum - 1) * limitNum;

    const filter = {};
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { invoiceNo:  { $regex: search, $options: 'i' } },
        { partyName:  { $regex: search, $options: 'i' } },
        { purchaseOrderRef: { $regex: search, $options: 'i' } },
        { 'items.description': { $regex: search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      StockInvoiceArchive.find(filter)
        .sort({ invoiceNo: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      StockInvoiceArchive.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/stock-invoice-archive/stats ──────────────────────────────────────
export const getStats = async (req, res) => {
  try {
    const [total, draft, approved, paid, totalValueAgg] = await Promise.all([
      StockInvoiceArchive.countDocuments(),
      StockInvoiceArchive.countDocuments({ status: 'Draft' }),
      StockInvoiceArchive.countDocuments({ status: 'Approved' }),
      StockInvoiceArchive.countDocuments({ status: 'Paid' }),
      StockInvoiceArchive.aggregate([{ $group: { _id: null, v: { $sum: '$grandTotal' } } }]),
    ]);

    res.json({
      success: true,
      data: {
        total,
        draft,
        approved,
        paid,
        totalValue: totalValueAgg[0]?.v || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/stock-invoice-archive/:id ────────────────────────────────────────
export const getById = async (req, res) => {
  try {
    const doc = await StockInvoiceArchive.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Archive record not found' });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/stock-invoice-archive/:id/status ───────────────────────────────
// Allow status updates on the archive copy (approve/mark paid independently)
export const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

    const doc = await StockInvoiceArchive.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Archive record not found' });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/stock-invoice-archive/:id ──────────────────────────────────────
export const remove = async (req, res) => {
  try {
    const doc = await StockInvoiceArchive.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Archive record not found' });
    // Also delete from main Invoice collection if it still exists
    if (doc.originalInvoiceId) {
      await Invoice.findByIdAndDelete(doc.originalInvoiceId).catch(() => {});
    }
    res.json({ success: true, message: 'Invoice deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/stock-invoice-archive/delete-all ────────────────────────────────
export const removeAll = async (req, res) => {
  try {
    const result = await StockInvoiceArchive.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── POST /api/stock-invoice-archive/sync ──────────────────────────────────────
// Backfill: copies all invoices from the Invoice collection that are NOT yet in
// the StockInvoiceArchive. Uses originalInvoiceId to detect existing records.
export const syncFromInvoices = async (req, res) => {
  try {
    // Get all originalInvoiceIds already archived
    const existingIds = await StockInvoiceArchive.distinct('originalInvoiceId');
    const existingSet = new Set(existingIds.map(id => id?.toString()));

    // Fetch all invoices from the main collection
    const allInvoices = await Invoice.find({}).lean();

    // Filter out already-archived ones
    const toArchive = allInvoices.filter(inv => !existingSet.has(inv._id?.toString()));

    if (toArchive.length === 0) {
      return res.json({ success: true, message: 'All invoices are already archived', synced: 0, total: allInvoices.length });
    }

    // Build archive documents
    const archiveDocs = toArchive.map(inv => ({
      originalInvoiceId: inv._id,
      invoiceNo:         inv.invoiceNo || '',
      invoiceDate:       inv.invoiceDate,
      dueDate:           inv.dueDate,
      partyName:         inv.partyName || '',
      partyAddress:      inv.partyAddress || '',
      partyGST:          inv.partyGST || '',
      partyEmail:        inv.partyEmail || '',
      partyPhone:        inv.partyPhone || '',
      partyCity:         inv.partyCity || '',
      partyState:        inv.partyState || '',
      billToName:        inv.billToName || '',
      billToAddress:     inv.billToAddress || '',
      billToGST:         inv.billToGST || '',
      shipToName:        inv.shipToName || '',
      shipToAddress:     inv.shipToAddress || '',
      shipToState:       inv.shipToState || '',
      shipToCity:        inv.shipToCity || '',
      companyName:       inv.companyName || 'Sri Chakra Industries',
      companyAddress:    inv.companyAddress || '',
      companyGST:        inv.companyGST || '',
      items:             (inv.items || []).map(it => ({
        description:      it.description || '',
        hsn:              it.hsn || '',
        qty:              it.qty || 0,
        unit:             it.unit || 'Nos',
        rate:             it.rate || 0,
        discount:         it.discount || 0,
        taxRate:          it.taxRate || 0,
        basic:            it.basic || 0,
        amount:           it.amount || 0,
        taxAmount:        it.taxAmount || 0,
        total:            it.total || 0,
        cgst:             it.cgst || 0,
        sgst:             it.sgst || 0,
        igst:             it.igst || 0,
        tallySalesLedger: it.tallySalesLedger || '',
      })),
      subtotal:          inv.subtotal || 0,
      totalDiscount:     inv.totalDiscount || 0,
      totalTax:          inv.totalTax || 0,
      grandTotal:        inv.grandTotal || 0,
      notes:             inv.notes || '',
      terms:             inv.terms || '',
      status:            inv.status || 'Draft',
      source:            inv.source || 'manual',
      invoiceType:       inv.invoiceType || 'single',
      uploadBatch:       inv.uploadBatch || '',
      purchaseOrderRef:  inv.purchaseOrderRef || '',
      poDate:            inv.poDate || '',
      uniqueId:          inv.uniqueId || '',
      vendorCode:        inv.vendorCode || '',
      brandName:         inv.brandName || '',
      orderStatus:       inv.orderStatus || '',
      originalCreatedAt: inv.createdAt,
      originalUpdatedAt: inv.updatedAt,
    }));

    // Insert in bulk
    const inserted = await StockInvoiceArchive.insertMany(archiveDocs, { ordered: false });

    console.log(`[sync] Backfilled ${inserted.length} invoices into StockInvoiceArchive`);
    res.json({
      success: true,
      message: `Synced ${inserted.length} invoices to archive`,
      synced: inserted.length,
      total: allInvoices.length,
      alreadyArchived: existingIds.length,
    });
  } catch (err) {
    console.error('[sync] StockInvoiceArchive sync error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
