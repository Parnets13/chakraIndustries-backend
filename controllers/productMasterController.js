import ProductMaster from '../models/ProductMaster.js';
import fs from 'fs';
import path from 'path';

const fmt = (p, baseUrl) => ({
  ...p.toObject(),
  primaryImageUrl: p.primaryImage
    ? (p.primaryImage.startsWith('http') ? p.primaryImage : `${baseUrl}${p.primaryImage}`)
    : '',
  imageUrls: (p.images || []).map(img =>
    img.startsWith('http') ? img : `${baseUrl}${img}`
  ),
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function cleanNumeric(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// ── GET all (with search + filter) ───────────────────────────────────────────
export const getAllProducts = async (req, res) => {
  try {
    const { search, category, brand, status, sortBy = 'createdAt', sortDir = 'desc', page = 1, limit = 100 } = req.query;
    const filter = {};

    if (search?.trim()) {
      filter.$or = [
        { productName: { $regex: search.trim(), $options: 'i' } },
        { sku:         { $regex: search.trim(), $options: 'i' } },
        { brand:       { $regex: search.trim(), $options: 'i' } },
        { category:    { $regex: search.trim(), $options: 'i' } },
      ];
    }
    if (category?.trim()) filter.category = { $regex: category.trim(), $options: 'i' };
    if (brand?.trim())    filter.brand    = { $regex: brand.trim(),    $options: 'i' };
    if (status?.trim())   filter.status   = status.trim();

    const sort = { [sortBy]: sortDir === 'asc' ? 1 : -1 };
    const skip = (Number(page) - 1) * Number(limit);

    const [products, total] = await Promise.all([
      ProductMaster.find(filter).sort(sort).skip(skip).limit(Number(limit)),
      ProductMaster.countDocuments(filter),
    ]);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, data: products.map(p => fmt(p, baseUrl)), total, page: Number(page) });
  } catch (err) {
    console.error('getAllProducts error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET single ────────────────────────────────────────────────────────────────
export const getProductById = async (req, res) => {
  try {
    const product = await ProductMaster.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, data: fmt(product, baseUrl) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── CREATE ────────────────────────────────────────────────────────────────────
export const createProduct = async (req, res) => {
  try {
    const { productName, category, brand, sku, unit, mrp, billingPrice } = req.body;

    // Mandatory validation
    if (!productName?.trim()) return res.status(400).json({ success: false, message: 'Product name is required' });
    if (!category?.trim())    return res.status(400).json({ success: false, message: 'Category is required' });
    if (!brand?.trim())       return res.status(400).json({ success: false, message: 'Brand is required' });
    if (!sku?.trim())         return res.status(400).json({ success: false, message: 'SKU is required' });
    if (!unit?.trim())        return res.status(400).json({ success: false, message: 'Unit is required' });
    if (!mrp && mrp !== 0)    return res.status(400).json({ success: false, message: 'MRP is required' });
    if (!billingPrice && billingPrice !== 0) return res.status(400).json({ success: false, message: 'Billing price is required' });
    // Image paths — optional when coming from employee approval flow
    const imageFiles = req.files || (req.file ? [req.file] : []);
    const isEmployeeSource = req.body.sourceType === 'employee';

    if (!imageFiles.length && !isEmployeeSource) {
      return res.status(400).json({ success: false, message: 'At least one product image is required' });
    }

    // If employee-sourced, reuse their uploaded image path
    let images = imageFiles.map(f => `/uploads/products/${f.filename}`);
    if (!images.length && isEmployeeSource && req.body.existingImagePath) {
      images = [req.body.existingImagePath];
    }

    const product = await ProductMaster.create({
      productName:      productName.trim(),
      category:         category.trim(),
      brand:            brand.trim(),
      sku:              sku.trim().toUpperCase(),
      unit:             unit.trim(),
      mrp:              cleanNumeric(mrp),
      billingPrice:     cleanNumeric(billingPrice),
      availableStock:   cleanNumeric(req.body.availableStock),
      description:      req.body.description?.trim() || '',
      status:           req.body.status || 'Active',
      images,
      primaryImage:     images[0] || '',
      // Specs
      modelNumber:      req.body.modelNumber?.trim() || '',
      color:            req.body.color?.trim() || '',
      weight:           req.body.weight?.trim() || '',
      dimensions:       req.body.dimensions?.trim() || '',
      capacity:         req.body.capacity?.trim() || '',
      powerConsumption: req.body.powerConsumption?.trim() || '',
      voltage:          req.body.voltage?.trim() || '',
      warranty:         req.body.warranty?.trim() || '',
      energyRating:     req.body.energyRating?.trim() || '',
      material:         req.body.material?.trim() || '',
      // Inventory
      purchasePrice:    cleanNumeric(req.body.purchasePrice),
      sellingPrice:     cleanNumeric(req.body.sellingPrice),
      gst:              cleanNumeric(req.body.gst),
      hsnCode:          req.body.hsnCode?.trim().toUpperCase() || '',
      barcode:          req.body.barcode?.trim() || '',
      minStock:         cleanNumeric(req.body.minStock),
      maxStock:         cleanNumeric(req.body.maxStock),
      reorderLevel:     cleanNumeric(req.body.reorderLevel),
      supplier:         req.body.supplier?.trim() || '',
      manufacturer:     req.body.manufacturer?.trim() || '',
      countryOfOrigin:  req.body.countryOfOrigin?.trim() || '',
      batchNumber:      req.body.batchNumber?.trim() || '',
      serialNumber:     req.body.serialNumber?.trim() || '',
      manufacturingDate: req.body.manufacturingDate ? new Date(req.body.manufacturingDate) : undefined,
      expiryDate:        req.body.expiryDate        ? new Date(req.body.expiryDate)        : undefined,
      createdBy: req.user?._id,
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ success: true, message: 'Product created successfully', data: fmt(product, baseUrl) });
  } catch (err) {
    console.error('createProduct error:', err);
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'SKU already exists' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── UPDATE ────────────────────────────────────────────────────────────────────
export const updateProduct = async (req, res) => {
  try {
    const product = await ProductMaster.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const fields = [
      'productName','category','brand','unit','description','status',
      'modelNumber','color','weight','dimensions','capacity','powerConsumption',
      'voltage','warranty','energyRating','material',
      'supplier','manufacturer','countryOfOrigin','batchNumber','serialNumber','hsnCode','barcode',
    ];
    fields.forEach(f => {
      if (req.body[f] !== undefined) product[f] = req.body[f]?.trim ? req.body[f].trim() : req.body[f];
    });

    const numFields = ['mrp','billingPrice','availableStock','purchasePrice','sellingPrice','gst','minStock','maxStock','reorderLevel'];
    numFields.forEach(f => {
      if (req.body[f] !== undefined) product[f] = cleanNumeric(req.body[f]);
    });

    if (req.body.sku) product.sku = req.body.sku.trim().toUpperCase();
    if (req.body.manufacturingDate) product.manufacturingDate = new Date(req.body.manufacturingDate);
    if (req.body.expiryDate)        product.expiryDate        = new Date(req.body.expiryDate);

    // New images uploaded
    if (req.files?.length || req.file) {
      const imageFiles = req.files || (req.file ? [req.file] : []);
      const newImages = imageFiles.map(f => `/uploads/products/${f.filename}`);
      product.images = [...(product.images || []), ...newImages];
      if (!product.primaryImage) product.primaryImage = newImages[0];
    }

    product.updatedBy = req.user?._id;
    await product.save();

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, message: 'Product updated successfully', data: fmt(product, baseUrl) });
  } catch (err) {
    console.error('updateProduct error:', err);
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'SKU already exists' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE ────────────────────────────────────────────────────────────────────
export const deleteProduct = async (req, res) => {
  try {
    const product = await ProductMaster.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // Delete uploaded image files from disk
    for (const img of product.images || []) {
      if (!img.startsWith('http')) {
        const filePath = path.join(process.cwd(), img);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }

    await product.deleteOne();
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET distinct categories & brands (for filters) ────────────────────────────
export const getFilters = async (req, res) => {
  try {
    const [categories, brands] = await Promise.all([
      ProductMaster.distinct('category'),
      ProductMaster.distinct('brand'),
    ]);
    res.json({ success: true, categories, brands });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Auto-generate SKU ─────────────────────────────────────────────────────────
export const generateSku = async (req, res) => {
  try {
    const { brand, category } = req.query;
    const prefix = `${(brand || 'PRD').slice(0,3)}${(category || 'CAT').slice(0,3)}`.toUpperCase().replace(/\s+/g, '');
    const count  = await ProductMaster.countDocuments();
    const sku    = `${prefix}-${String(count + 1).padStart(4, '0')}`;
    res.json({ success: true, sku });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
