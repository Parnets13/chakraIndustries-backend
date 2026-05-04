import ItemMaster from '../models/ItemMaster.js';

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
    const { sku, name, description, category, unit, unitPrice, costPrice, sellingPrice, minQuantity, maxQuantity, reorderPoint, hsn, gst, barcode } = req.body;

    // Validate required fields
    if (!sku || !name || !unit) {
      return res.status(400).json({ success: false, message: 'SKU, Name, and Unit are required' });
    }

    // Check if SKU already exists
    const existing = await ItemMaster.findOne({ sku: sku.toUpperCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: `SKU ${sku} already exists` });
    }

    const itemId = await generateItemId();

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
      barcode,
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
    const { status, isActive, category } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (category) filter.category = category;

    const items = await ItemMaster.find(filter)
      .populate('category', 'name')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: items });
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
    const { sku, name, description, category, unit, unitPrice, costPrice, sellingPrice, minQuantity, maxQuantity, reorderPoint, status, isActive, hsn, gst, barcode } = req.body;

    // Check if SKU is being changed and if new SKU already exists
    if (sku) {
      const existing = await ItemMaster.findOne({ sku: sku.toUpperCase(), _id: { $ne: req.params.id } });
      if (existing) {
        return res.status(400).json({ success: false, message: `SKU ${sku} already exists` });
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
      ...(barcode && { barcode }),
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
      ],
      isActive: true,
      status: 'Active'
    })
      .populate('category', 'name')
      .limit(20);

    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET DROPDOWN - Get items for dropdown (minimal data)
export const getItemsForDropdown = async (req, res) => {
  try {
    const items = await ItemMaster.find({ isActive: true, status: 'Active' })
      .select('_id itemId sku name unit')
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
