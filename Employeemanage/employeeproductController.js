import EmployeeProduct from '../models/Employeeproduct.js';

const LOCKED_STATUSES = ['Approved', 'Rejected'];

// ── Safe date parser — returns null for empty / invalid values ─────────────────
function safeDate(val) {
  if (!val || val === '' || val === 'null' || val === 'undefined') return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}
export const formatEmployeeProduct = (product, baseUrl = '') => {
  const imagePath = product.productImage || '';
  // Ensure HTTPS in production (behind reverse proxy, req.protocol may be 'http')
  const safeBaseUrl = baseUrl.replace(/^http:\/\//, 'https://');
  const productImageUrl = imagePath.startsWith('http')
    ? imagePath
    : imagePath
      ? `${safeBaseUrl}${imagePath}`
      : '';

  return {
    _id: product._id,
    id: product._id,
    employee: product.employee,
    employeeName: product.employeeName || '',
    employeeId:   product.employeeId   || '',
    productName: product.productName,
    productImage: product.productImage,
    productImageUrl,
    quantity: product.quantity,
    netQty: product.netQty ?? 0,
    unit: product.unit || '',
    modelNumber: product.modelNumber || '',
    color: product.color || '',
    category: product.category || '',
    brand: product.brand || '',
    sku: product.sku || '',
    mrp: product.mrp ?? 0,
    billingPrice: product.billingPrice ?? 0,
    sellingPrice: product.sellingPrice ?? 0,
    purchasePrice: product.purchasePrice ?? 0,
    gst: product.gst ?? 0,
    hsnCode: product.hsnCode || '',
    barcode: product.barcode || '',
    availableStock: product.availableStock ?? 0,
    minStock: product.minStock ?? 0,
    maxStock: product.maxStock ?? 0,
    reorderLevel: product.reorderLevel ?? 0,
    warranty: product.warranty || '',
    remark: product.remark || '',
    expectedDeliveryDate: product.expectedDeliveryDate,
    manufacturingDate: product.manufacturingDate || null,
    expiryDate: product.expiryDate || null,
    supplier: product.supplier || '',
    manufacturer: product.manufacturer || '',
    countryOfOrigin: product.countryOfOrigin || '',
    batchNumber: product.batchNumber || '',
    serialNumber: product.serialNumber || '',
    // Extended spec fields
    weight:           product.weight           || '',
    dimensions:       product.dimensions       || '',
    capacity:         product.capacity         || '',
    powerConsumption: product.powerConsumption || '',
    voltage:          product.voltage          || '',
    energyRating:     product.energyRating     || '',
    material:         product.material         || '',
    description:      product.description      || '',
    status: product.status,
    reviewedBy: product.reviewedBy || '',
    reviewedAt: product.reviewedAt,
    adminNotes: product.adminNotes || '',
    creditDate: product.creditDate || null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
};

// ── Employee: list own products ───────────────────────────────────────────────
export const getMyProducts = async (req, res) => {
  try {
    const products = await EmployeeProduct.find({ employee: req.user._id }).sort({ createdAt: -1 });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, data: products.map(p => formatEmployeeProduct(p, baseUrl)) });
  } catch (error) {
    console.error('getMyProducts error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch products' });
  }
};

// ── Employee: get single own product ─────────────────────────────────────────
export const getMyProductById = async (req, res) => {
  try {
    const product = await EmployeeProduct.findOne({ _id: req.params.id, employee: req.user._id });
    if (!product)
      return res.status(404).json({ success: false, message: 'Product not found' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, data: formatEmployeeProduct(product, baseUrl) });
  } catch (error) {
    console.error('getMyProductById error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch product' });
  }
};

// ── Employee: create product ──────────────────────────────────────────────────
export const createProduct = async (req, res) => {
  try {
    const {
      productName, quantity, netQty, unit, modelNumber, color, category,
      brand, sku, mrp, billingPrice, sellingPrice, purchasePrice,
      gst, hsnCode, barcode,
      availableStock, minStock, maxStock, reorderLevel,
      warranty, remark, expectedDeliveryDate,
      manufacturingDate, expiryDate,
      supplier, manufacturer, countryOfOrigin, batchNumber, serialNumber,
      // New spec fields
      weight, dimensions, capacity, powerConsumption, voltage,
      energyRating, material, description,
    } = req.body;

    if (!productName?.trim())
      return res.status(400).json({ success: false, message: 'Product name is required' });
    if (!req.file)
      return res.status(400).json({ success: false, message: 'Product image is required' });

    // Default expectedDeliveryDate to 7 days from now if not provided
    const deliveryDate = expectedDeliveryDate
      ? new Date(expectedDeliveryDate)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Default quantity to 1 if not provided
    const qty = quantity ? Number(quantity) : 1;

    const product = await EmployeeProduct.create({
      employee:      req.user._id,
      employeeName:  req.user.name || req.user.fullName || '',
      employeeId:    `EMP-${String(req.user._id).slice(-6).toUpperCase()}`,
      productName:   productName.trim(),
      productImage:  `/uploads/employee-products/${req.file.filename}`,
      quantity:      qty,
      netQty:        netQty ? Number(netQty) : 0,
      unit:          unit?.trim() || '',
      modelNumber:   modelNumber?.trim() || '',
      color:         color?.trim() || '',
      category:      category?.trim() || '',
      brand:         brand?.trim() || '',
      sku:           sku?.trim() || '',
      mrp:           mrp ? Number(mrp) : 0,
      billingPrice:  billingPrice ? Number(billingPrice) : 0,
      sellingPrice:  sellingPrice ? Number(sellingPrice) : 0,
      purchasePrice: purchasePrice ? Number(purchasePrice) : 0,
      gst:           gst ? Number(gst) : 0,
      hsnCode:       hsnCode?.trim() || '',
      barcode:       barcode?.trim() || '',
      availableStock:availableStock ? Number(availableStock) : 0,
      minStock:      minStock ? Number(minStock) : 0,
      maxStock:      maxStock ? Number(maxStock) : 0,
      reorderLevel:  reorderLevel ? Number(reorderLevel) : 0,
      warranty:      warranty?.trim() || '',
      remark:        remark?.trim() || '',
      expectedDeliveryDate: deliveryDate,
      manufacturingDate: safeDate(manufacturingDate),
      expiryDate:        safeDate(expiryDate),
      supplier:          supplier?.trim() || '',
      manufacturer:      manufacturer?.trim() || '',
      countryOfOrigin:   countryOfOrigin?.trim() || '',
      batchNumber:       batchNumber?.trim() || '',
      serialNumber:      serialNumber?.trim() || '',
      // Extended spec fields
      weight:           weight?.trim() || '',
      dimensions:       dimensions?.trim() || '',
      capacity:         capacity?.trim() || '',
      powerConsumption: powerConsumption?.trim() || '',
      voltage:          voltage?.trim() || '',
      energyRating:     energyRating?.trim() || '',
      material:         material?.trim() || '',
      description:      description?.trim() || '',
      status:           'Pending',
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.status(201).json({
      success: true,
      message: 'Product saved successfully',
      data: formatEmployeeProduct(product, baseUrl),
    });
  } catch (error) {
    console.error('createProduct error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to save product' });
  }
};

// ── Employee: update product (only before admin approval) ─────────────────────
export const updateProduct = async (req, res) => {
  try {
    const product = await EmployeeProduct.findOne({ _id: req.params.id, employee: req.user._id });
    if (!product)
      return res.status(404).json({ success: false, message: 'Product not found' });
    if (LOCKED_STATUSES.includes(product.status))
      return res.status(403).json({ success: false, message: 'Cannot edit product after admin approval or rejection' });

    const {
      productName, quantity, netQty, unit, modelNumber, color, category,
      brand, sku, mrp, billingPrice, sellingPrice, purchasePrice,
      gst, hsnCode, barcode,
      availableStock, minStock, maxStock, reorderLevel,
      warranty, remark, expectedDeliveryDate,
      manufacturingDate, expiryDate,
      supplier, manufacturer, countryOfOrigin, batchNumber, serialNumber,
      // Extended spec fields
      weight, dimensions, capacity, powerConsumption, voltage,
      energyRating, material, description,
    } = req.body;

    if (productName !== undefined) {
      if (!productName?.trim())
        return res.status(400).json({ success: false, message: 'Product name cannot be empty' });
      product.productName = productName.trim();
    }
    if (quantity !== undefined) {
      if (Number(quantity) < 1)
        return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });
      product.quantity = Number(quantity);
    }
    if (netQty        !== undefined) product.netQty        = Number(netQty) || 0;
    if (unit          !== undefined) product.unit          = unit?.trim() || '';
    if (modelNumber   !== undefined) product.modelNumber   = modelNumber?.trim() || '';
    if (color         !== undefined) product.color         = color?.trim() || '';
    if (category      !== undefined) product.category      = category?.trim() || '';
    if (brand         !== undefined) product.brand         = brand?.trim() || '';
    if (sku           !== undefined) product.sku           = sku?.trim() || '';
    if (mrp           !== undefined) product.mrp           = Number(mrp) || 0;
    if (billingPrice  !== undefined) product.billingPrice  = Number(billingPrice) || 0;
    if (sellingPrice  !== undefined) product.sellingPrice  = Number(sellingPrice) || 0;
    if (purchasePrice !== undefined) product.purchasePrice = Number(purchasePrice) || 0;
    if (gst           !== undefined) product.gst           = Number(gst) || 0;
    if (hsnCode       !== undefined) product.hsnCode       = hsnCode?.trim() || '';
    if (barcode       !== undefined) product.barcode       = barcode?.trim() || '';
    if (availableStock !== undefined) product.availableStock = Number(availableStock) || 0;
    if (minStock      !== undefined) product.minStock      = Number(minStock) || 0;
    if (maxStock      !== undefined) product.maxStock      = Number(maxStock) || 0;
    if (reorderLevel  !== undefined) product.reorderLevel  = Number(reorderLevel) || 0;
    if (warranty      !== undefined) product.warranty      = warranty?.trim() || '';
    if (remark        !== undefined) product.remark        = remark?.trim() || '';
    if (supplier      !== undefined) product.supplier      = supplier?.trim() || '';
    if (manufacturer  !== undefined) product.manufacturer  = manufacturer?.trim() || '';
    if (countryOfOrigin !== undefined) product.countryOfOrigin = countryOfOrigin?.trim() || '';
    if (batchNumber   !== undefined) product.batchNumber   = batchNumber?.trim() || '';
    if (serialNumber  !== undefined) product.serialNumber  = serialNumber?.trim() || '';
    if (manufacturingDate !== undefined) product.manufacturingDate = safeDate(manufacturingDate);
    if (expiryDate        !== undefined) product.expiryDate        = safeDate(expiryDate);
    // Extended spec fields
    if (weight           !== undefined) product.weight           = weight?.trim() || '';
    if (dimensions       !== undefined) product.dimensions       = dimensions?.trim() || '';
    if (capacity         !== undefined) product.capacity         = capacity?.trim() || '';
    if (powerConsumption !== undefined) product.powerConsumption = powerConsumption?.trim() || '';
    if (voltage          !== undefined) product.voltage          = voltage?.trim() || '';
    if (energyRating     !== undefined) product.energyRating     = energyRating?.trim() || '';
    if (material         !== undefined) product.material         = material?.trim() || '';
    if (description      !== undefined) product.description      = description?.trim() || '';

    if (expectedDeliveryDate !== undefined) {
      product.expectedDeliveryDate = safeDate(expectedDeliveryDate) || product.expectedDeliveryDate;
    }
    if (req.file) product.productImage = `/uploads/employee-products/${req.file.filename}`;

    await product.save();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, message: 'Product updated successfully', data: formatEmployeeProduct(product, baseUrl) });
  } catch (error) {
    console.error('updateProduct error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update product' });
  }
};

// ── Employee: delete product ──────────────────────────────────────────────────
export const deleteProduct = async (req, res) => {
  try {
    const product = await EmployeeProduct.findOne({ _id: req.params.id, employee: req.user._id });
    if (!product)
      return res.status(404).json({ success: false, message: 'Product not found' });
    if (LOCKED_STATUSES.includes(product.status))
      return res.status(403).json({ success: false, message: 'Cannot delete product after admin approval or rejection' });

    await product.deleteOne();
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('deleteProduct error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete product' });
  }
};

// ── Admin: delete any product ─────────────────────────────────────────────────
export const deleteProductAdmin = async (req, res) => {
  try {
    const product = await EmployeeProduct.findById(req.params.id);
    if (!product)
      return res.status(404).json({ success: false, message: 'Product not found' });

    // Delete the image file from disk if it's a local path
    if (product.productImage && !product.productImage.startsWith('http')) {
      const filePath = `${process.cwd()}${product.productImage}`;
      try {
        const { existsSync, unlinkSync } = await import('fs');
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch { /* non-fatal */ }
    }

    await product.deleteOne();
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('deleteProductAdmin error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete product' });
  }
};

// ── Admin: list all products ──────────────────────────────────────────────────
export const getAllProductsAdmin = async (req, res) => {
  try {
    const { productName, status, category, brand, dateFrom, dateTo } = req.query;
    const filter = {};
    if (productName?.trim()) filter.productName = { $regex: productName.trim(), $options: 'i' };
    if (status?.trim())      filter.status      = status.trim();
    if (category?.trim())    filter.category    = { $regex: category.trim(), $options: 'i' };
    if (brand?.trim())       filter.brand       = { $regex: brand.trim(), $options: 'i' };
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) { const e = new Date(dateTo); e.setHours(23, 59, 59, 999); filter.createdAt.$lte = e; }
    }

    const products = await EmployeeProduct.find(filter)
      .populate('employee', 'name email mobile mobileNumber department designation')
      .sort({ createdAt: -1 });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, data: products.map(p => formatEmployeeProduct(p, baseUrl)) });
  } catch (error) {
    console.error('getAllProductsAdmin error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch products' });
  }
};

// ── Admin: single product ─────────────────────────────────────────────────────
export const getProductByIdAdmin = async (req, res) => {
  try {
    const product = await EmployeeProduct.findById(req.params.id)
      .populate('employee', 'name email mobile mobileNumber department designation joiningDate address photo profilePhoto');
    if (!product)
      return res.status(404).json({ success: false, message: 'Product not found' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, data: formatEmployeeProduct(product, baseUrl) });
  } catch (error) {
    console.error('getProductByIdAdmin error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch product' });
  }
};

// ── Admin: update status ──────────────────────────────────────────────────────
export const updateProductStatusAdmin = async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const allowed = ['Pending', 'Under Review', 'Approved', 'Rejected'];
    if (!status || !allowed.includes(status))
      return res.status(400).json({ success: false, message: 'Valid status is required' });

    const product = await EmployeeProduct.findById(req.params.id);
    if (!product)
      return res.status(404).json({ success: false, message: 'Product not found' });

    product.status = status;
    if (adminNotes !== undefined) product.adminNotes = adminNotes?.trim() || '';
    if (['Approved', 'Rejected', 'Under Review'].includes(status)) {
      product.reviewedBy = req.user?.name || req.user?.email || 'Admin';
      product.reviewedAt = new Date();
    }
    if (status === 'Approved' && !product.creditDate) product.creditDate = new Date();

    await product.save();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, message: `Status updated to ${status}`, data: formatEmployeeProduct(product, baseUrl) });
  } catch (error) {
    console.error('updateProductStatusAdmin error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update status' });
  }
};