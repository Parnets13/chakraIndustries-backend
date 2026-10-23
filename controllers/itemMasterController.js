import ItemMaster from '../models/ItemMaster.js';

// ── Barcode generator (EAN-13 style, 13 digits) ───────────────────────────────
const generateBarcodeValue = () => {
  // 12 random digits + EAN-13 check digit
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const checkDigit = (10 - (digits.reduce((sum, d, i) => sum + d * (i % 2 === 0 ? 1 : 3), 0) % 10)) % 10;
  return [...digits, checkDigit].join('');
};

// Ensure uniqueness — retry up to 5 times
const generateUniqueBarcode = async () => {
  for (let i = 0; i < 5; i++) {
    const value = generateBarcodeValue();
    const exists = await ItemMaster.findOne({ barcode: value });
    if (!exists) return value;
  }
  throw new Error('Could not generate a unique barcode — please try again');
};

// Generate Item ID
const generateItemId = async () => {
  const year = new Date().getFullYear();
  const prefix = `ITEM-${year}-`;
  const last = await ItemMaster.findOne({ itemId: new RegExp(`^${prefix}`) })
    .sort({ itemId: -1 })
    .limit(1);
  if (!last) return `${prefix}001`;
  const lastNum = parseInt(last.itemId.split('-')[2]) || 0;
  return `${prefix}${String(lastNum + 1).padStart(3, '0')}`;
};

// CREATE - Add new item to master
export const createItem = async (req, res) => {
  try {
    const { sku, name, description, category, unit, unitPrice, costPrice, sellingPrice, minQuantity, maxQuantity, reorderPoint, hsn, gst, barcode, tallySalesLedger } = req.body;

    // Validate required fields
    if (!sku || !name || !unit) {
      return res.status(400).json({ success: false, message: 'SKU, Name, and Unit are required' });
    }

    // Check if SKU already exists
    const existing = await ItemMaster.findOne({ sku: sku.toUpperCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: `SKU ${sku} already exists` });
    }

    // If a barcode was manually provided, ensure it is not already in use
    if (barcode && barcode.trim()) {
      const barcodeConflict = await ItemMaster.findOne({ barcode: barcode.trim() });
      if (barcodeConflict) {
        return res.status(400).json({
          success: false,
          message: `Barcode ${barcode} is already assigned to SKU ${barcodeConflict.sku} (${barcodeConflict.name})`
        });
      }
    }

    const itemId = await generateItemId();

    // Auto-generate a unique barcode if none was provided
    const finalBarcode = (barcode && barcode.trim()) ? barcode.trim() : await generateUniqueBarcode();

    const item = new ItemMaster({
      itemId,
      sku: sku.toUpperCase(),
      name,
      description,
      category,
      unit,
      unitPrice: parseFloat(unitPrice) || 0,
      costPrice: parseFloat(costPrice) || 0,
      sellingPrice: parseFloat(sellingPrice) || 0,
      minQuantity: parseInt(minQuantity) || 0,
      maxQuantity: parseInt(maxQuantity) || 0,
      reorderPoint: parseInt(reorderPoint) || 0,
      hsn,
      gst: parseFloat(gst) || 0,
      barcode: finalBarcode,
      ...(tallySalesLedger !== undefined && { tallySalesLedger: String(tallySalesLedger).trim() }),
      createdBy: req.user?._id
    });

    const saved = await item.save();
    const populated = await ItemMaster.findById(saved._id).populate('category', 'name');

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// READ ALL - Get all items
export const getAllItems = async (req, res) => {
  try {
    const { status, isActive, category, search, page, limit } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (category) filter.category = category;
    if (search) {
      filter.$or = [
        { itemName: { $regex: search, $options: 'i' } },
        { itemCode: { $regex: search, $options: 'i' } },
        { sku:      { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum  = parseInt(page)  || 0;
    const limitNum = parseInt(limit) || 0;
    const usePagination = pageNum > 0 && limitNum > 0;
    const skip = usePagination ? (pageNum - 1) * limitNum : 0;

    const [items, totalCount] = await Promise.all([
      ItemMaster.find(filter)
        .populate('category', 'name')
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(usePagination ? skip : 0)
        .limit(usePagination ? limitNum : 0),
      usePagination ? ItemMaster.countDocuments(filter) : Promise.resolve(null),
    ]);

    const response = { success: true, data: items };
    if (usePagination) {
      response.pagination = {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
      };
    }
    res.json(response);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ ONE - Get item by ID
export const getItemById = async (req, res) => {
  try {
    const item = await ItemMaster.findById(req.params.id)
      .populate('category', 'name')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ - Get item by SKU
export const getItemBySku = async (req, res) => {
  try {
    const item = await ItemMaster.findOne({ sku: req.params.sku.toUpperCase() })
      .populate('category', 'name');

    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// UPDATE - Update item
export const updateItem = async (req, res) => {
  try {
    const { sku, name, description, category, unit, unitPrice, costPrice, sellingPrice, minQuantity, maxQuantity, reorderPoint, status, isActive, hsn, gst, barcode, tallySalesLedger } = req.body;

    // Check if SKU is being changed and if new SKU already exists
    if (sku) {
      const existing = await ItemMaster.findOne({ sku: sku.toUpperCase(), _id: { $ne: req.params.id } });
      if (existing) {
        return res.status(400).json({ success: false, message: `SKU ${sku} already exists` });
      }
    }

    // If barcode is being changed, ensure it is not already in use by another item
    if (barcode && barcode.trim()) {
      const barcodeConflict = await ItemMaster.findOne({ barcode: barcode.trim(), _id: { $ne: req.params.id } });
      if (barcodeConflict) {
        return res.status(400).json({
          success: false,
          message: `Barcode ${barcode} is already assigned to SKU ${barcodeConflict.sku} (${barcodeConflict.name})`
        });
      }
    }

    const updateData = {
      ...(sku && { sku: sku.toUpperCase() }),
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(category && { category }),
      ...(unit && { unit }),
      ...(unitPrice !== undefined && { unitPrice: parseFloat(unitPrice) }),
      ...(costPrice !== undefined && { costPrice: parseFloat(costPrice) }),
      ...(sellingPrice !== undefined && { sellingPrice: parseFloat(sellingPrice) }),
      ...(minQuantity !== undefined && { minQuantity: parseInt(minQuantity) }),
      ...(maxQuantity !== undefined && { maxQuantity: parseInt(maxQuantity) }),
      ...(reorderPoint !== undefined && { reorderPoint: parseInt(reorderPoint) }),
      ...(status && { status }),
      ...(isActive !== undefined && { isActive }),
      ...(hsn && { hsn }),
      ...(gst !== undefined && { gst: parseFloat(gst) }),
      ...(barcode && barcode.trim() && { barcode: barcode.trim() }),
      // tallySalesLedger: allow empty string to CLEAR the value (user intentionally clearing it)
      ...(tallySalesLedger !== undefined && { tallySalesLedger: String(tallySalesLedger).trim() }),
      updatedBy: req.user?._id
    };

    const item = await ItemMaster.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
      .populate('category', 'name')
      .populate('updatedBy', 'name email');

    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    res.json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE - Delete item
export const deleteItem = async (req, res) => {
  try {
    const item = await ItemMaster.findByIdAndDelete(req.params.id);

    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// SEARCH - Search items by name or SKU
export const searchItems = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ success: false, message: 'Search query must be at least 2 characters' });
    }

    const items = await ItemMaster.find({
      $or: [
        { sku: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
        { itemId: { $regex: q, $options: 'i' } }
      ]
    })
      .select('_id itemId sku name unit costPrice status')
      .populate('category', 'name')
      .limit(20);

    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET DROPDOWN - Get items for dropdown (minimal data)
// Returns all items so BOM / Work Order selectors are not blocked by status filters
export const getItemsForDropdown = async (req, res) => {
  try {
    const items = await ItemMaster.find({})
      .select('_id itemId sku name unit costPrice status isActive')
      .sort({ name: 1 });

    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET STATS - Get item master statistics
export const getItemStats = async (req, res) => {
  try {
    const total = await ItemMaster.countDocuments();
    const active = await ItemMaster.countDocuments({ status: 'Active', isActive: true });
    const inactive = await ItemMaster.countDocuments({ status: 'Inactive' });
    const discontinued = await ItemMaster.countDocuments({ status: 'Discontinued' });

    res.json({
      success: true,
      data: {
        total,
        active,
        inactive,
        discontinued
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET BY BARCODE - Look up a product by its barcode value
export const getItemByBarcode = async (req, res) => {
  try {
    const item = await ItemMaster.findOne({ barcode: req.params.barcode.trim() })
      .populate('category', 'name');

    if (!item) {
      return res.status(404).json({ success: false, message: 'No product found for this barcode' });
    }

    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE ALL - Delete all items from item master
export const deleteAllItems = async (req, res) => {
  try {
    const result = await ItemMaster.deleteMany({});
    res.json({ success: true, message: `${result.deletedCount} stock items deleted` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// REGENERATE BARCODE - Admin-only: force a new unique barcode for an existing item
export const regenerateBarcode = async (req, res) => {
  try {
    const item = await ItemMaster.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    const oldBarcode = item.barcode;
    const newBarcode = await generateUniqueBarcode();

    item.barcode = newBarcode;
    item.updatedBy = req.user?._id;
    await item.save();

    res.json({
      success: true,
      message: `Barcode regenerated for ${item.sku}`,
      data: { sku: item.sku, name: item.name, oldBarcode, newBarcode }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── BULK HSN UPDATE ──────────────────────────────────────────────────────────
/**
 * POST /api/itemmasters/bulk-hsn
 *
 * Body: Array of { name, hsn } objects.
 *       name  — exact item name (case-sensitive) OR regex pattern prefixed with "regex:"
 *               e.g. "regex:Orient 16.*Pedestal Fan"  (flags: i always applied)
 *       hsn   — HSN/SAC code string, e.g. "84145930"
 *
 * Returns a per-item result: matched / modified / skipped counts and any errors.
 * Validates HSN format (4–8 digit numeric) before writing. Rejects blanks.
 *
 * Example body:
 * [
 *   { "name": "Bajaj ICX 160TS Neo Induction Stove", "hsn": "85166000" },
 *   { "name": "LIV-ENVY-WAAS",                       "hsn": "84212190" },
 *   { "name": "regex:Orient 16.*Pedestal Fan",        "hsn": "84145930" }
 * ]
 */
export const bulkUpdateHsn = async (req, res) => {
  try {
    const rows = req.body;

    // ── Input validation ─────────────────────────────────────────────────────
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Body must be a non-empty array of { name, hsn } objects',
      });
    }
    if (rows.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 2000 items per request. Split into smaller batches.',
      });
    }

    // HSN: 4–8 digit numeric string (covers both HSN goods codes and SAC service codes)
    const HSN_RE = /^\d{4,8}$/;

    const results  = [];
    let totalMatched  = 0;
    let totalModified = 0;
    let totalSkipped  = 0;
    let totalErrors   = 0;

    for (const row of rows) {
      const rawName = (row.name || '').toString().trim();
      const rawHsn  = (row.hsn  || '').toString().trim();
      const rowIdx  = rows.indexOf(row);

      // ── Per-row validation ─────────────────────────────────────────────────
      if (!rawName) {
        results.push({ name: rawName, hsn: rawHsn, status: 'skipped', reason: 'name is blank' });
        totalSkipped++;
        continue;
      }
      if (!rawHsn) {
        results.push({ name: rawName, hsn: rawHsn, status: 'skipped', reason: 'hsn is blank' });
        totalSkipped++;
        continue;
      }
      if (!HSN_RE.test(rawHsn)) {
        results.push({ name: rawName, hsn: rawHsn, status: 'error', reason: `Invalid HSN "${rawHsn}" — must be 4–8 digits` });
        totalErrors++;
        continue;
      }

      // ── Build MongoDB filter ───────────────────────────────────────────────
      let filter;
      if (rawName.startsWith('regex:')) {
        const pattern = rawName.slice('regex:'.length).trim();
        if (!pattern) {
          results.push({ name: rawName, hsn: rawHsn, status: 'skipped', reason: 'regex pattern is empty after "regex:" prefix' });
          totalSkipped++;
          continue;
        }
        filter = { name: { $regex: pattern, $options: 'i' } };
      } else {
        filter = { name: rawName };
      }

      // ── Execute update (regex → updateMany, exact name → upsert) ────────────
      try {
        if (rawName.startsWith('regex:')) {
          // Regex: update all matching items (no upsert — we can't generate a valid sku for unknown items)
          const result = await ItemMaster.updateMany(filter, { $set: { hsn: rawHsn } });
          const matched  = result.matchedCount  || 0;
          const modified = result.modifiedCount || 0;
          totalMatched  += matched;
          totalModified += modified;
          if (matched === 0) {
            results.push({ name: rawName, hsn: rawHsn, status: 'not_found', matched: 0, modified: 0 });
          } else {
            results.push({ name: rawName, hsn: rawHsn, status: 'ok', matched, modified });
          }
        } else {
          // Exact name: upsert — creates item if it doesn't exist yet
          const sku = 'HSN-' + rawName.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 20) + '-' + Date.now().toString(36).slice(-4).toUpperCase();
          const doc = await ItemMaster.findOneAndUpdate(
            { name: rawName },
            {
              $set: { hsn: rawHsn },
              $setOnInsert: {
                name:         rawName,
                itemId:       sku,
                sku:          sku,
                unit:         'Nos',
                unitPrice:    0,
                costPrice:    0,
                sellingPrice: 0,
                isActive:     true,
                dataSource:   'ERP',
              },
            },
            { upsert: true, new: true }
          );
          const wasNew = doc && !doc.updatedAt;
          totalMatched  += 1;
          totalModified += 1;
          results.push({ name: rawName, hsn: rawHsn, status: 'ok', matched: 1, modified: 1, created: !doc?.tallyGuid && wasNew });
        }
      } catch (updateErr) {
        results.push({ name: rawName, hsn: rawHsn, status: 'error', reason: updateErr.message });
        totalErrors++;
      }
    }

    return res.json({
      success: true,
      summary: {
        total:         rows.length,
        totalMatched,
        totalModified,
        totalSkipped,
        totalErrors,
        totalNotFound: results.filter(r => r.status === 'not_found').length,
      },
      results,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
