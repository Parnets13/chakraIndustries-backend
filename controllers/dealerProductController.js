import Category from '../models/Category.js';
import CorporateClient from '../models/CorporateClient.js';
import Inventory from '../models/Inventory.js';
import InventoryItem from '../models/InventoryItem.js';
import ItemMaster from '../models/ItemMaster.js';

const toInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const toBool = (value) => {
  if (value === true) return true;
  if (value === false) return false;
  if (value === undefined || value === null) return false;
  const s = String(value).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
};

const normalizeMobile = (mobile = '') => String(mobile).replace(/\D/g, '').slice(-10);
const normalizeGstin = (gstin = '') => String(gstin).toUpperCase().replace(/\s/g, '');

const getDealerDiscountPercentage = async (dealer) => {
  if (!dealer) return 0;
  const mobile = normalizeMobile(dealer.mobile);
  const gst = normalizeGstin(dealer.gstin || '');
  let client = null;
  if (gst) client = await CorporateClient.findOne({ gstNumber: gst }).select('discountPercentage');
  if (!client && mobile) client = await CorporateClient.findOne({ phone: mobile }).select('discountPercentage');
  if (!client) {
    const name = (dealer.businessName || dealer.name || '').trim();
    if (name) client = await CorporateClient.findOne({ name: { $regex: `^${name}$`, $options: 'i' } }).select('discountPercentage');
  }
  const disc = Number(client?.discountPercentage || 0);
  return Number.isFinite(disc) ? disc : 0;
};

const getInventoryStockMap = async (skus = []) => {
  const normalizedSkus = skus.map((s) => String(s).toUpperCase());
  const match = normalizedSkus.length ? { sku: { $in: normalizedSkus } } : {};

  const map = new Map();

  // ERP inventory module currently uses InventoryItem/qty for stock totals.
  // Dealer app must match the same ERP-visible stock numbers.
  const erpRows = await InventoryItem.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$sku',
        qty: { $sum: { $ifNull: ['$qty', 0] } },
        minQty: { $max: { $ifNull: ['$minQty', 0] } },
      },
    },
  ]);

  for (const row of erpRows) {
    map.set(String(row._id), { qty: row.qty || 0, minQty: row.minQty || 0 });
  }

  const missingSkus = normalizedSkus.filter((s) => !map.has(String(s)));
  if (missingSkus.length === 0) return map;

  // Fallback only where ERP InventoryItem does not have rows but Inventory model does.
  const fallbackRows = await InventoryItem.aggregate([
    { $match: { sku: { $in: [] } } },
    { $group: { _id: '$sku', qty: { $sum: '$qty' }, minQty: { $max: '$minQty' } } },
  ]);

  if (fallbackRows.length === 0) {
    const inventoryRows = await Inventory.aggregate([
      { $match: { sku: { $in: missingSkus } } },
      {
        $group: {
          _id: '$sku',
          qty: {
            $sum: {
              $ifNull: ['$availableQuantity', { $ifNull: ['$totalQuantity', { $ifNull: ['$quantity', 0] }] }],
            },
          },
          minQty: { $max: { $ifNull: ['$minQuantity', 0] } },
        },
      },
    ]);

    for (const row of inventoryRows) {
      if (!map.has(String(row._id))) {
        map.set(String(row._id), { qty: row.qty || 0, minQty: row.minQty || 0 });
      }
    }
  }

  return map;
};

const toDealerProduct = (itemMaster, stockRow, discountPercentage) => {
  const stock = stockRow?.qty || 0;
  const minQty = itemMaster.minQuantity || stockRow?.minQty || 1; // Default to 1 instead of 0 or 24

  let stockStatus = 'In Stock';
  if (stock <= 0) stockStatus = 'Out of Stock';
  else if (minQty > 0 && stock < minQty) stockStatus = 'Low Stock';

  const basePrice = itemMaster.sellingPrice || itemMaster.unitPrice || 0;
  const disc = Number(discountPercentage || 0);
  const discountAmount = basePrice * (disc / 100);
  const finalPrice = Math.max(0, +(basePrice - discountAmount).toFixed(2));
  const moq = itemMaster.minQuantity || 1; // Default MOQ to 1 instead of 24 if not set

  return {
    id: itemMaster._id,
    sku: itemMaster.sku,
    name: itemMaster.name,
    description: itemMaster.description || '',
    category: itemMaster.category?.name || 'Uncategorized',
    categoryId: itemMaster.category?._id,
    price: finalPrice,
    basePrice,
    discountPercentage: disc,
    discountAmount: +discountAmount.toFixed(2),
    moq,
    stock,
    stockStatus,
    unit: itemMaster.unit,
    hsn: itemMaster.hsn || '',
    gst: itemMaster.gst || 0,
  };
};

const buildItemMasterFilter = async ({ categoryName, categoryId, search }) => {
  const filter = { isActive: true };

  if (categoryId) {
    filter.category = categoryId;
  } else if (categoryName && categoryName !== 'All Products') {
    const category = await Category.findOne({ name: { $regex: `^${categoryName}$`, $options: 'i' } });
    filter.category = category?._id;
  }

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { sku: { $regex: search, $options: 'i' } },
      { itemId: { $regex: search, $options: 'i' } },
    ];
  }

  return filter;
};

export const getDealerProducts = async (req, res) => {
  try {
    const { category, search } = req.query;
    const inStock = toBool(req.query.inStock);
    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
    const skip = (page - 1) * limit;

    const filter = await buildItemMasterFilter({ categoryName: category, search });
    const itemMasters = await ItemMaster.find(filter)
      .populate('category', 'name')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    const skus = itemMasters.map((i) => i.sku);
    const stockMap = await getInventoryStockMap(skus);
    const discountPercentage = await getDealerDiscountPercentage(req.dealer);

    const products = itemMasters
      .map((i) => toDealerProduct(i, stockMap.get(i.sku), discountPercentage))
      .filter((p) => (inStock ? p.stock > 0 : true));

    res.json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch products' });
  }
};

export const searchDealerProducts = async (req, res) => {
  req.query.search = req.query.search || req.query.q || '';
  return getDealerProducts(req, res);
};

export const getDealerProductById = async (req, res) => {
  try {
    const itemMaster = await ItemMaster.findById(req.params.id).populate('category', 'name');
    if (!itemMaster) return res.status(404).json({ success: false, message: 'Product not found' });

    const stockMap = await getInventoryStockMap([itemMaster.sku]);
    const discountPercentage = await getDealerDiscountPercentage(req.dealer);
    res.json({ success: true, data: toDealerProduct(itemMaster, stockMap.get(itemMaster.sku), discountPercentage) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch product' });
  }
};

export const getDealerProductsByCategoryId = async (req, res) => {
  try {
    const { id: categoryId } = req.params;
    req.query.category = undefined;
    req.query.search = req.query.search || '';
    const filter = await buildItemMasterFilter({ categoryId, search: req.query.search });

    const itemMasters = await ItemMaster.find(filter).populate('category', 'name').sort({ updatedAt: -1 });
    const skus = itemMasters.map((i) => i.sku);
    const stockMap = await getInventoryStockMap(skus);
    const discountPercentage = await getDealerDiscountPercentage(req.dealer);
    const products = itemMasters.map((i) => toDealerProduct(i, stockMap.get(i.sku), discountPercentage));

    res.json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch products' });
  }
};

export const getDealerProductCategories = async (req, res) => {
  try {
    const categories = await Category.find().sort({ createdAt: 1 });
    const itemMasters = await ItemMaster.find({ isActive: true }, 'category sku');
    const skus = itemMasters.map((i) => i.sku);
    const stockMap = await getInventoryStockMap(skus);

    const byCategory = new Map();
    for (const im of itemMasters) {
      const catId = im.category ? String(im.category) : '';
      const row = stockMap.get(im.sku);
      const hasStock = (row?.qty || 0) > 0;
      const current = byCategory.get(catId) || { count: 0, anyInStock: false };
      current.count += 1;
      current.anyInStock = current.anyInStock || hasStock;
      byCategory.set(catId, current);
    }

    const result = categories.map((c) => {
      const meta = byCategory.get(String(c._id)) || { count: 0, anyInStock: false };
      return {
        id: c._id,
        name: c.name,
        productCount: meta.count,
        status: meta.anyInStock ? 'In stock' : 'Out of stock',
      };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch categories' });
  }
};

export const getDealerCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
    res.json({ success: true, data: { id: category._id, name: category.name } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch category' });
  }
};
