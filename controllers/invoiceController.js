import Invoice from '../models/Invoice.js';
import SalesOrder from '../models/SalesOrder.js';
import Dealer from '../models/Dealer.js';
import AccountsReceivable from '../models/AccountsReceivable.js';
import ItemMaster from '../models/ItemMaster.js';
import { sendInvoiceEmail } from '../utils/emailService.js';
import { pushSingleInvoiceToTally } from '../services/tallyService.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import TallyConfig from '../models/TallyConfig.js';

// ── ItemMaster lookup: attach tallySalesLedger + hsn to each invoice item ─────
// Runs one DB query for all item names in the invoice, then stamps each item
// with ItemMaster.tallySalesLedger and ItemMaster.hsn so normalizeToTallyVoucher
// can use the correct per-item sales ledger instead of the generic 'Sales Accounts'.
async function enrichItemsFromItemMaster(items) {
  if (!items || !items.length) return items;
  const names = [...new Set(items.map(i => (i.description || i.name || '').trim()).filter(Boolean))];
  if (!names.length) return items;
  const masters = await ItemMaster.find({ name: { $in: names } }, 'name hsn tallySalesLedger').lean();
  const masterMap = new Map(masters.map(m => [m.name, m]));
  return items.map(item => {
    const name = (item.description || item.name || '').trim();
    const im   = masterMap.get(name);
    return {
      ...item,
      hsn:             item.hsn             || im?.hsn             || '',
      // Do NOT fall back to the item name as tallySalesLedger.
      // Using a stock item name as GSTLEDGERSOURCE in Tally XML causes EXCEPTIONS=1.
      tallySalesLedger: item.tallySalesLedger || im?.tallySalesLedger || '',
    };
  });
}

// ── Build Tally-native voucher sub-document (non-fatal) ───────────────────────
// Called at every write. If normalization fails (e.g. zero grandTotal on a draft)
// we store null and let the legacy export path handle it rather than blocking the save.
async function buildTallyVoucher(invoiceData) {
  try {
    const cfg = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
    const periodEnd = cfg?.tallyPeriodEnd || null;
    // Enrich items with ItemMaster data before normalizing
    const enrichedItems = await enrichItemsFromItemMaster(invoiceData.items || []);
    return normalizeToTallyVoucher({ ...invoiceData, items: enrichedItems }, { periodEnd });
  } catch (err) {
    console.warn('[Invoice] tallyVoucher normalization skipped:', err.message);
    return null;
  }
}

// ── ID generator ──────────────────────────────────────────────────────────────
const genInvoiceNo = async () => {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await Invoice.findOne({ invoiceNo: new RegExp(`^${prefix}`) })
    .sort({ createdAt: -1 });
  if (!last) return `${prefix}0001`;
  const parts = last.invoiceNo.split('-');
  const num = parseInt(parts[parts.length - 1]) || 0;
  return `${prefix}${String(num + 1).padStart(4, '0')}`;
};

// ── Compute totals from items ─────────────────────────────────────────────────
const computeTotals = (items = []) => {
  let subtotal = 0, totalDiscount = 0, totalTax = 0;
  const computed = items.map(item => {
    const base     = (item.qty || 0) * (item.rate || 0);
    const discAmt  = base * ((item.discount || 0) / 100);
    // Use item.basic from Excel directly when present — it is the authoritative
    // taxable amount from the source document. Computing from rate*qty and rounding
    // causes a 1-paisa drift (e.g. 219.0476×1 → 219.05) that breaks Tally's
    // e-invoice tax validation ("Tax amount does not match").
    const amount   = item.basic > 0 ? item.basic : (base - discAmt);

    // Use stored tax amounts if provided (from Excel), otherwise compute from taxRate
    const storedCGST = item.cgst || 0;
    const storedSGST = item.sgst || 0;
    const storedIGST = item.igst || 0;
    const storedTax  = storedCGST + storedSGST + storedIGST;

    const taxAmt   = storedTax > 0 ? storedTax : amount * ((item.taxRate || 0) / 100);
    // Use item.total from Excel as the authoritative line total when available.
    // Recomputing amount + taxAmt accumulates rounding errors across items.
    const total    = (item.total > 0) ? item.total : (amount + taxAmt);

    subtotal      += base;
    totalDiscount += discAmt;
    totalTax      += taxAmt;

    return {
      ...item,
      basic:     +amount.toFixed(2),   // taxable amount (qty × rate − discount)
      amount:    +amount.toFixed(2),
      taxAmount: +taxAmt.toFixed(2),
      total:     +total.toFixed(2),
      cgst:      storedCGST,
      sgst:      storedSGST,
      igst:      storedIGST,
    };
  });
  // Use the sum of item.total values as grandTotal when items have stored totals —
  // this avoids the rounding drift from summing base+tax separately.
  const hasStoredTotals = items.some(i => i.total > 0);
  const grandTotal = hasStoredTotals
    ? computed.reduce((s, i) => s + i.total, 0)
    : (subtotal - totalDiscount + totalTax);
  return {
    items: computed,
    subtotal:      +subtotal.toFixed(2),
    totalDiscount: +totalDiscount.toFixed(2),
    totalTax:      +totalTax.toFixed(2),
    grandTotal:    +grandTotal.toFixed(2),
  };
};

// ── GET /api/invoices ─────────────────────────────────────────────────────────
export const getAll = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 0, invoiceType, invoiceSource } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (invoiceType) filter.invoiceType = invoiceType;
    if (invoiceSource) filter.invoiceSource = invoiceSource;
    if (search) filter.$or = [
      { invoiceNo:  { $regex: search, $options: 'i' } },
      { partyName:  { $regex: search, $options: 'i' } },
      { purchaseOrderRef: { $regex: search, $options: 'i' } },
    ];

    const limitNum = parseInt(limit);
    const query = Invoice.find(filter).sort({ serialNo: 1, createdAt: 1 });

    // limit=0 means fetch all (no pagination)
    if (limitNum > 0) {
      const skip = (parseInt(page) - 1) * limitNum;
      query.skip(skip).limit(limitNum);
    }

    const [list, total] = await Promise.all([
      query,
      Invoice.countDocuments(filter),
    ]);
    res.json({ success: true, data: list, total, page: parseInt(page), limit: limitNum });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/invoices/stats ───────────────────────────────────────────────────
export const getStats = async (req, res) => {
  try {
    const [total, draft, sent, paid, overdue, cancelled, singleCount, multiCount, totalValueAgg, paidValueAgg, pendingValueAgg] =
      await Promise.all([
        Invoice.countDocuments(),
        Invoice.countDocuments({ status: 'Draft' }),
        Invoice.countDocuments({ status: 'Sent' }),
        Invoice.countDocuments({ status: 'Paid' }),
        Invoice.countDocuments({ status: 'Overdue' }),
        Invoice.countDocuments({ status: 'Cancelled' }),
        Invoice.countDocuments({ invoiceType: 'single' }),
        Invoice.countDocuments({ invoiceType: 'multi' }),
        Invoice.aggregate([{ $group: { _id: null, v: { $sum: '$grandTotal' } } }]),
        Invoice.aggregate([{ $match: { status: 'Paid' } }, { $group: { _id: null, v: { $sum: '$grandTotal' } } }]),
        Invoice.aggregate([{ $match: { status: { $in: ['Draft','Sent','Overdue'] } } }, { $group: { _id: null, v: { $sum: '$grandTotal' } } }]),
      ]);
    res.json({
      success: true,
      data: {
        total, draft, sent, paid, overdue, cancelled,
        singleCount, multiCount,
        totalValue:   totalValueAgg[0]?.v   || 0,
        paidValue:    paidValueAgg[0]?.v    || 0,
        pendingValue: pendingValueAgg[0]?.v || 0,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/invoices/:id ─────────────────────────────────────────────────────
export const getById = async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: inv });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/invoices ────────────────────────────────────────────────────────
export const create = async (req, res) => {
  try {
    const invoiceNo = await genInvoiceNo();
    const { items = [], ...rest } = req.body;
    const totals = computeTotals(items);
    const invoiceType = items.length > 1 ? 'multi' : 'single';
    const invoiceData = { invoiceNo, ...rest, ...totals, source: 'manual', invoiceType };
    invoiceData.tallyVoucher = await buildTallyVoucher(invoiceData);
    const inv = await Invoice.create(invoiceData);
    await AccountsReceivable.create({
      dealer: inv.dealerId,
      salesOrder: inv.salesOrderId,
      invoice: inv._id,
      invoiceNumber: inv.invoiceNo,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      invoiceAmount: inv.grandTotal
    });
    res.status(201).json({ success: true, data: inv });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── POST /api/invoices/bulk-upload ────────────────────────────────────────────
// Accepts array of invoice objects parsed from Excel on the frontend.
// Uses insertMany (single DB round-trip) instead of a sequential loop —
// handles 1000+ rows without hitting body-size or timeout limits.
export const bulkUpload = async (req, res) => {
  try {
    const { invoices = [] } = req.body;
    if (!invoices.length)
      return res.status(400).json({ success: false, message: 'No invoices provided' });

    const batchId = `BATCH-${Date.now()}`;
    const year    = new Date().getFullYear();
    const prefix  = `INV-${year}-`;

    // One query to find the current highest number
    const last = await Invoice.findOne({ invoiceNo: new RegExp(`^${prefix}`) })
      .sort({ createdAt: -1 })
      .select('invoiceNo');
    const lastNum = last ? (parseInt(last.invoiceNo.split('-').pop()) || 0) : 0;

    // Fetch TallyConfig once for period end (used by normalizer for all rows)
    const cfg = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
    const periodEnd = cfg?.tallyPeriodEnd || null;

    // ── Log what the frontend actually sent — confirms tallySalesLedger arrives ──
    console.log(`[bulkUpload] INCOMING: ${invoices.length} invoices from frontend`);
    invoices.slice(0, 3).forEach((inv, ii) => {
      (inv.items || []).forEach((it, j) => {
        console.log(`[bulkUpload] INCOMING inv[${ii}] item[${j}]: "${it.description || it.name}" tallySalesLedger="${it.tallySalesLedger || ''}" hsn="${it.hsn || ''}"`);
      });
    });

    // ── Pre-fetch ItemMaster for all item names across all uploaded rows ──────
    // Avoids per-row DB queries and ensures tallySalesLedger + hsn are stamped
    // on every item so normalizeToTallyVoucher can emit ALLINVENTORYENTRIES.
    const allItemNames = [...new Set(
      invoices.flatMap(inv => (inv.items || []).map(i => (i.description || i.name || '').trim()).filter(Boolean))
    )];
    const itemMasterDocs = allItemNames.length
      ? await ItemMaster.find({ name: { $in: allItemNames } }, 'name hsn tallySalesLedger').lean()
      : [];
    const itemMasterMap = new Map(itemMasterDocs.map(m => [m.name, m]));

    // ── Auto-create ItemMaster entries for any new item names ─────────────────
    // If an item from the Excel doesn't exist in ItemMaster yet, create it now.
    // This ensures:
    //  1. Item name is registered in ERP item catalog automatically
    //  2. Once a Tally Sales Ledger is later set on the item, all future uploads
    //     of the same item will immediately pick it up — no manual work needed
    //  3. Second upload of the same item → no duplicate (upsert by name)
    const existingNames = new Set(itemMasterDocs.map(m => m.name));
    const newItemNames  = allItemNames.filter(n => !existingNames.has(n));
    if (newItemNames.length > 0) {
      console.log(`[bulkUpload] Auto-creating ${newItemNames.length} new ItemMaster entries: ${newItemNames.slice(0, 5).join(', ')}${newItemNames.length > 5 ? '...' : ''}`);
      // Build upsert ops — ordered:false means all succeed even if some clash
      const upsertOps = newItemNames.map(name => {
        const cleanName = name.trim();
        // Generate a stable SKU from the name
        const sku = 'AUTO-' + cleanName.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 25) + '-' + Date.now().toString(36).slice(-4).toUpperCase();
        // Collect the first tallySalesLedger seen for this item name across all uploaded rows.
        // This seeds ItemMaster so future uploads and re-exports immediately use the correct ledger.
        const firstItemWithLedger = invoices.flatMap(inv => inv.items || []).find(i => {
          const n = (i.description || i.name || '').trim();
          return n === cleanName && (i.tallySalesLedger || '').trim();
        });
        const seedLedger = (firstItemWithLedger?.tallySalesLedger || '').trim();
        return {
          updateOne: {
            filter: { name: cleanName },
            update: {
              $setOnInsert: {
                name:        cleanName,
                itemId:      sku,
                sku:         sku,
                unit:        'Nos',
                unitPrice:   0,
                costPrice:   0,
                sellingPrice:0,
                isActive:    true,
                dataSource:  'excel_upload',
                tallySalesLedger: seedLedger,
              },
            },
            upsert: true,
          },
        };
      });
      try {
        await ItemMaster.bulkWrite(upsertOps, { ordered: false });
        // Re-fetch so new items are in the map for this upload
        const newDocs = await ItemMaster.find({ name: { $in: newItemNames } }, 'name hsn tallySalesLedger').lean();
        newDocs.forEach(m => itemMasterMap.set(m.name, m));
        console.log(`[bulkUpload] Auto-created ${newDocs.length} ItemMaster entries`);
      } catch (imErr) {
        console.warn('[bulkUpload] ItemMaster auto-create partial error (non-fatal):', imErr.message);
      }
    }

    console.log(`[bulkUpload] DEBUG: ${allItemNames.length} unique item names, ${itemMasterDocs.length} found in ItemMaster`);

    // ── Eager backfill: for existing items whose tallySalesLedger is blank,
    //    write the value from the Excel rows NOW — before the debug log and
    //    before normalizeToTallyVoucher runs — so the in-memory map is accurate.
    const backfillOps = [];
    for (const name of allItemNames) {
      const im = itemMasterMap.get(name);
      if (!im) continue; // will be handled by $setOnInsert path above
      if (im.tallySalesLedger) continue; // already has a value — don't overwrite
      // Find the first uploaded row for this item that carries a Sales Ledger value
      const firstWithLedger = invoices
        .flatMap(inv => inv.items || [])
        .find(i => (i.description || i.name || '').trim() === name && (i.tallySalesLedger || '').trim());
      if (!firstWithLedger) continue;
      const newLedger = firstWithLedger.tallySalesLedger.trim();
      im.tallySalesLedger = newLedger; // update in-memory map immediately
      backfillOps.push({
        updateOne: {
          filter: { name, $or: [{ tallySalesLedger: { $exists: false } }, { tallySalesLedger: '' }] },
          update: { $set: { tallySalesLedger: newLedger } },
        },
      });
    }
    if (backfillOps.length > 0) {
      console.log(`[bulkUpload] Backfilling tallySalesLedger for ${backfillOps.length} existing ItemMaster entries`);
      ItemMaster.bulkWrite(backfillOps, { ordered: false }).catch(e =>
        console.warn('[bulkUpload] tallySalesLedger backfill error (non-fatal):', e.message)
      );
    }

    allItemNames.forEach(n => {
      const im = itemMasterMap.get(n);
      console.log(`[bulkUpload] DEBUG item "${n}": hsn="${im?.hsn || ''}" tallySalesLedger="${im?.tallySalesLedger || ''}"`);
    });

    // Build all docs in memory — no per-row DB calls
    const docs   = [];
    const errors = [];

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      try {
        const invoiceNo = `${prefix}${String(lastNum + docs.length + 1).padStart(4, '0')}`;
        const { items = [], ...rest } = inv;
        const totals = computeTotals(items);
        const invoiceData = {
          invoiceNo,
          ...rest,
          ...totals,
          source:      'excel_upload',
          uploadBatch: batchId,
          serialNo:    i + 1,
          status:      rest.status || 'Draft',
          invoiceType: items.length > 1 ? 'multi' : 'single',
        };
        // Enrich items with ItemMaster tallySalesLedger + hsn using the pre-fetched map.
        // This ensures normalizeToTallyVoucher can populate ALLINVENTORYENTRIES
        // (item name, HSN, unit rate) in the Tally voucher sub-document.
        const enrichedItems = (invoiceData.items || []).map(item => {
          const name = (item.description || item.name || '').trim();
          const im   = itemMasterMap.get(name);
          // tallySalesLedger priority:
          // 1. What's on this specific item row from the Excel (parsed Sales Ledger column)
          // 2. What's stored in ItemMaster (manually set via Item Master UI or previous upload)
          // 3. Empty string — do NOT fall back to the item description/name.
          //    Using the item name as tallySalesLedger causes it to be sent as
          //    GSTLEDGERSOURCE in Tally XML, but stock item names are NOT ledgers.
          //    Tally silently returns EXCEPTIONS=1 when a non-ledger is used there.
          const tallySalesLedger = (item.tallySalesLedger || '').trim() || (im?.tallySalesLedger || '').trim();
          return {
            ...item,
            hsn:             (item.hsn || '').trim() || (im?.hsn || '').trim(),
            tallySalesLedger,
          };
        });
        console.log(`[bulkUpload] DEBUG row ${i+1}: invoiceNo=${invoiceNo} partyName="${invoiceData.partyName}" purchaseOrderRef="${invoiceData.purchaseOrderRef}" poDate="${invoiceData.poDate}" shipToName="${invoiceData.shipToName}" shipToAddress="${invoiceData.shipToAddress}" items=${enrichedItems.length}`);
        enrichedItems.forEach((it, j) => console.log(`[bulkUpload] DEBUG  item[${j}]: "${it.description}" qty=${it.qty} rate=${it.rate} cgst=${it.cgst} sgst=${it.sgst} igst=${it.igst} tallySalesLedger="${it.tallySalesLedger}"`));
        invoiceData.items = enrichedItems;
        // Normalize to Tally-native structure at write time.
        // If it fails (e.g. missing partyName), exclude row with a reason.
        try {
          invoiceData.tallyVoucher = normalizeToTallyVoucher(invoiceData, { periodEnd });
        } catch (normErr) {
          // normalization failure → tallyVoucher = null (legacy export fallback)
          invoiceData.tallyVoucher = null;
          console.warn(`[bulkUpload] row ${i+1} tallyVoucher skipped: ${normErr.message}`);
        }
        docs.push(invoiceData);
      } catch (e) {
        errors.push({ row: i + 1, error: e.message });
      }
    }

    if (!docs.length) {
      return res.status(400).json({ success: false, message: 'All rows failed validation', errors });
    }

    // Single insertMany — ordered:false means valid docs still insert even if some fail
    let inserted = [];
    try {
      inserted = await Invoice.insertMany(docs, { ordered: false });
    } catch (bulkErr) {
      // BulkWriteError: partial success — some docs inserted, some failed
      if (bulkErr.insertedDocs) inserted = bulkErr.insertedDocs;
      else if (bulkErr.result?.insertedIds) {
        // Mongoose may not populate insertedDocs; fetch them by batchId
        inserted = await Invoice.find({ uploadBatch: batchId });
      }
      errors.push({ row: 'multiple', error: bulkErr.message });
    }

    res.status(201).json({
      success: true,
      data: { created: inserted.length, errors, batchId, invoices: inserted },
    });
  } catch (err) {
    console.error('[bulkUpload]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/invoices/:id ─────────────────────────────────────────────────────
export const update = async (req, res) => {
  try {
    const { items = [], ...rest } = req.body;
    const totals = computeTotals(items);
    const invoiceType = items.length > 1 ? 'multi' : 'single';

    // Re-normalize tallyVoucher on every save.
    // If the invoice was previously exported to Tally (tallySync=true), clear
    // it so the updated invoice will be re-exported on the next export run.
    const existing = await Invoice.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const updatedData = {
      ...existing,
      ...rest,
      items: totals.items,
      subtotal: totals.subtotal,
      totalDiscount: totals.totalDiscount,
      totalTax: totals.totalTax,
      grandTotal: totals.grandTotal,
      invoiceType,
    };

    // Re-normalize (non-fatal — preserve existing tallyVoucher on failure)
    let newTallyVoucher = existing.tallyVoucher;
    try {
      const cfg = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
      newTallyVoucher = normalizeToTallyVoucher(updatedData, { periodEnd: cfg?.tallyPeriodEnd || null });
    } catch (normErr) {
      console.warn(`[update] tallyVoucher re-normalization failed for ${req.params.id}: ${normErr.message}`);
    }

    const updatePayload = { ...rest, ...totals, invoiceType, tallyVoucher: newTallyVoucher };
    // Clear tallySync if the invoice was previously synced — it changed, needs re-export
    if (existing.tallySync) {
      updatePayload.tallySync = false;
      updatePayload.tallySyncAt = null;
    }

    const inv = await Invoice.findByIdAndUpdate(
      req.params.id,
      updatePayload,
      { new: true, runValidators: true }
    );
    res.json({ success: true, data: inv });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── PATCH /api/invoices/:id/status ────────────────────────────────────────────
export const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const inv = await Invoice.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: inv });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── POST /api/invoices/migrate-types ─────────────────────────────────────────
// One-time migration: set invoiceType on all existing docs based on items.length
export const migrateTypes = async (req, res) => {
  try {
    const all = await Invoice.find({}, { _id: 1, items: 1 });
    const ops = all.map(inv => ({
      updateOne: {
        filter: { _id: inv._id },
        update: { $set: { invoiceType: (inv.items?.length || 0) > 1 ? 'multi' : 'single' } },
      },
    }));
    const result = await Invoice.bulkWrite(ops, { ordered: false });
    res.json({ success: true, updated: result.modifiedCount, total: all.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── DELETE /api/invoices (delete all) ────────────────────────────────────────
export const removeAll = async (req, res) => {
  try {
    const result = await Invoice.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── DELETE /api/invoices/:id ──────────────────────────────────────────────────
export const remove = async (req, res) => {
  try {
    const inv = await Invoice.findByIdAndDelete(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/invoices/:id/send-email ─────────────────────────────────────────
// Frontend sends pdfBase64 (jsPDF output); backend attaches it and emails via Nodemailer.
export const sendEmail = async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const { pdfBase64 } = req.body;
    if (!pdfBase64)
      return res.status(400).json({ success: false, message: 'pdfBase64 is required' });

    const to = inv.partyEmail;
    if (!to)
      return res.status(400).json({ success: false, message: 'Invoice has no recipient email address' });

    await sendInvoiceEmail({
      to,
      partyName:   inv.partyName,
      invoice:     inv.toObject(),
      pdfBase64,
      pdfFilename: `${inv.invoiceNo}.pdf`,
    });

    // Auto-advance status from Draft → Sent
    if (inv.status === 'Draft') {
      await Invoice.findByIdAndUpdate(req.params.id, { status: 'Sent' });
    }

    res.json({ success: true, message: `Invoice emailed to ${to}` });
  } catch (err) {
    console.error('[sendEmail]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/invoices/no/:invoiceNo ─────────────────────────────────────────
export const getByInvoiceNo = async (req, res) => {
  try {
    const inv = await Invoice.findOne({ invoiceNo: req.params.invoiceNo });
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: inv });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/invoices/from-order/:orderId ────────────────────────────────────
export const createFromSalesOrder = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found' });
    
    // Check if invoice already exists for this order
    const existingInvoice = await Invoice.findOne({ salesOrderId: order._id });
    if (existingInvoice) return res.status(400).json({ success: false, message: 'Invoice already exists for this order' });
    
    // Get dealer details if available
    let dealer = null;
    if (order.dealerId) {
      dealer = await Dealer.findById(order.dealerId);
    }
    
    const invoiceNo = await genInvoiceNo();
    
    // Build invoice items from order lineItems or items
    const items = [];
    if (order.lineItems && order.lineItems.length > 0) {
      order.lineItems.forEach(item => {
        const taxRate = item.gstPercent || 0;
        items.push({
          description: item.name || 'Item',
          hsn: '',
          qty: item.quantity || 0,
          unit: 'Nos',
          rate: item.unitPrice || 0,
          discount: 0,
          taxRate,
          cgst: (item.gstAmount || 0) / 2,
          sgst: (item.gstAmount || 0) / 2,
          igst: 0
        });
      });
    } else if (order.items && order.items.length > 0) {
      order.items.forEach(item => {
        const taxRate = item.gstPercent || 0;
        items.push({
          description: item.itemName || 'Item',
          hsn: '',
          qty: item.quantity || 0,
          unit: 'Nos',
          rate: item.unitPrice || 0,
          discount: 0,
          taxRate,
          cgst: (item.gstAmount || 0) / 2,
          sgst: (item.gstAmount || 0) / 2,
          igst: 0
        });
      });
    }
    
    const totals = computeTotals(items);
    
    // Create invoice
    const invoiceData = {
      invoiceNo,
      invoiceDate: new Date(),
      dealerId: order.dealerId || null,
      salesOrderId: order._id,
      partyName: dealer?.businessName || dealer?.name || order.customer || 'Customer',
      partyAddress: dealer?.address || '',
      partyGST: dealer?.gstin || '',
      partyEmail: dealer?.email || '',
      partyPhone: dealer?.mobile || '',
      billToName: dealer?.businessName || dealer?.name || order.customer || 'Customer',
      billToAddress: dealer?.address || '',
      billToGST: dealer?.gstin || '',
      shipToName: dealer?.businessName || dealer?.name || order.customer || 'Customer',
      shipToAddress: order.deliveryAddress || '',
      purchaseOrderRef: order.orderId,
      items: totals.items,
      subtotal: totals.subtotal,
      totalDiscount: totals.totalDiscount,
      totalTax: totals.totalTax,
      grandTotal: totals.grandTotal,
      status: 'Draft',
      paymentStatus: 'Pending',
      source: 'manual',
      invoiceType: items.length > 1 ? 'multi' : 'single'
    };
    invoiceData.tallyVoucher = await buildTallyVoucher(invoiceData);
    const invoice = await Invoice.create(invoiceData);
    
    await AccountsReceivable.create({
      dealer: invoice.dealerId,
      salesOrder: invoice.salesOrderId,
      invoice: invoice._id,
      invoiceNumber: invoice.invoiceNo,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      invoiceAmount: invoice.grandTotal
    });
    
    res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    console.error('createFromSalesOrder error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/invoices/renormalize-all ────────────────────────────────────────
// Re-runs normalizeToTallyVoucher on every ERP invoice so that any fix to the
// normalizer (e.g. the itemSalesBase bug fix) is applied to already-stored docs.
// Safe to run multiple times — updates tallyVoucher in-place, preserves all other fields.
export const renormalizeAll = async (req, res) => {
  try {
    const cfg = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
    const periodEnd = cfg?.tallyPeriodEnd || null;

    // Process in batches to avoid memory pressure on large collections
    const BATCH = 100;
    let skip = 0, updated = 0, failed = 0, skipped = 0;
    const failedInvoices = [];

    while (true) {
      const batch = await Invoice.find(
        { source: { $ne: 'Tally' } },
        null,
        { skip, limit: BATCH, lean: true }
      );
      if (!batch.length) break;

      const ops = [];
      for (const inv of batch) {
        try {
          const enrichedItems = await enrichItemsFromItemMaster(inv.items || []);
          const tallyVoucher = normalizeToTallyVoucher(
            { ...inv, items: enrichedItems },
            { periodEnd }
          );
          // Also reset tallySync so the invoice will be re-exported with the corrected voucher
          ops.push({
            updateOne: {
              filter: { _id: inv._id },
              update: { $set: { tallyVoucher, tallySync: false, tallySyncAt: null } },
            },
          });
          updated++;
        } catch (err) {
          failed++;
          failedInvoices.push({ id: inv._id, invoiceNo: inv.invoiceNo, error: err.message });
        }
      }

      if (ops.length) await Invoice.bulkWrite(ops, { ordered: false });
      skip += BATCH;
    }

    res.json({ success: true, updated, failed, skipped, failedInvoices: failedInvoices.slice(0, 20) });
  } catch (err) {
    console.error('[renormalizeAll]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/invoices/:id/send-to-tally ──────────────────────────────────────
// One-click push of a single ERP invoice into Tally as a Sales Voucher.
// After a successful push the invoice's tallySync flag is set to true.
export const sendToTally = async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id).lean();
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    if (inv.source === 'Tally' || inv.source === 'tally') {
      return res.status(400).json({ success: false, message: 'This invoice was imported from Tally — no need to push back.' });
    }

    const result = await pushSingleInvoiceToTally(req.params.id);

    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.error || 'Failed to push invoice to Tally' });
    }

    // Fetch updated invoice to return fresh tallySync status
    const updated = await Invoice.findById(req.params.id).lean();
    res.json({
      success: true,
      message: `Invoice ${result.invoiceNo} pushed to Tally successfully`,
      data: updated,
      warning: result.warning || null,
      duration: result.duration,
    });
  } catch (err) {
    console.error('[sendToTally]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
