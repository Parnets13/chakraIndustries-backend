import InventoryItem from '../models/InventoryItem.js';
import ItemMaster from '../models/ItemMaster.js';
import Warehouse from '../models/Warehouse.js';

const normalizeSku = (sku) => String(sku || '').trim().toUpperCase();

const getQty = (inv) => {
  return Number(inv.qty || 0);
};

const parseWarehouseLocation = (location) => {
  const raw = String(location || '').trim();
  if (!raw) return { pincode: '', city: '' };
  const [pincodeRaw, ...rest] = raw.split(',');
  const pincode = String(pincodeRaw || '').trim();
  const city = rest.join(',').trim();
  return { pincode, city };
};

const mapInventoryRow = (row) => ({
  sku: row._id,
  availableQty: row.qty || 0,
});

// Get list of all warehouses
export const getDealerWarehouses = async (req, res) => {
  try {
    // First get all unique warehouses from InventoryItem (where items are actually stored!)
    const inventoryWarehouses = await InventoryItem.aggregate([
      { $match: { warehouse: { $exists: true, $ne: null, $ne: '' } } },
      { $group: { _id: '$warehouse', name: { $first: '$warehouse' } } },
      { $sort: { _id: 1 } }
    ]);

    console.log('Found inventory warehouses:', inventoryWarehouses);

    // Then get warehouses from Warehouse model
    const warehouseDocs = await Warehouse.find({ status: 'Active' }).sort({ name: 1 });
    console.log('Found Warehouse docs:', warehouseDocs);

    // Combine them, avoiding duplicates
    const warehouseMap = new Map();

    // Add inventory warehouses first (using name as id to ensure matching!)
    inventoryWarehouses.forEach(w => {
      warehouseMap.set(w.name, {
        id: w.name, // Use name as id so we can match directly!
        name: w.name
      });
    });

    // Add warehouses from Warehouse model if not already present
    warehouseDocs.forEach(w => {
      if (!warehouseMap.has(w.name)) {
        warehouseMap.set(w.name, {
          id: w.name, // Use name as id here too!
          name: w.name
        });
      }
    });

    const warehouseList = Array.from(warehouseMap.values());

    console.log('Final warehouse list:', warehouseList);

    res.json({ success: true, data: warehouseList });
  } catch (error) {
    console.error('getDealerWarehouses error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch warehouses' });
  }
};

// Get items for a specific warehouse
export const getDealerWarehouseItems = async (req, res) => {
  try {
    const warehouseId = String(req.params.warehouseId || '').trim();
    const search = String(req.query.search || '').trim();

    console.log('getDealerWarehouseItems called with:', { warehouseId, search });

    // Now warehouseId IS the warehouse name!
    let match = { warehouse: warehouseId };

    if (search) {
      match.$or = [
        { sku: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
      ];
    }

    console.log('Finding InventoryItem with match:', match);
    const items = await InventoryItem.find(match).populate('category', 'name');
    console.log('Found items:', items.length);

    const itemsWithDetails = await Promise.all(
      items.map(async (item) => {
        const itemMaster = await ItemMaster.findOne({ sku: item.sku }).populate('category', 'name');
        return {
          id: item._id,
          sku: item.sku,
          name: item.name || itemMaster?.name || 'Unknown Item',
          qty: getQty(item),
          unit: item.unit || itemMaster?.unit || 'units',
          minQty: item.minQty || itemMaster?.minQuantity || 0,
          category: itemMaster?.category?.name || 'Uncategorized',
          categoryId: itemMaster?.category?._id,
          price: itemMaster?.sellingPrice || itemMaster?.unitPrice || 0,
          moq: itemMaster?.minQuantity || 1,
          status: item.status || 'Active'
        };
      })
    );

    console.log('Returning items:', itemsWithDetails.length);
    res.json({ success: true, data: itemsWithDetails });
  } catch (error) {
    console.error('getDealerWarehouseItems error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch warehouse items' });
  }
};

// Get full inventory stock for the Dealer App InventoryPage
// Returns items with name, sku, qty, warehouse, category, status
export const getDealerInventoryStock = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();

    const match = {};
    if (search) {
      match.$or = [
        { sku:  { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
      ];
    }

    console.log('=== getDealerInventoryStock called ===');

    const items = await InventoryItem.find(match)
      .populate('category', 'name')
      .lean();

    console.log(`Found ${items.length} InventoryItem records`);

    // Enrich with ItemMaster data where possible
    const skus = [...new Set(items.map(i => normalizeSku(i.sku)).filter(Boolean))];
    const masters = await ItemMaster.find({ sku: { $in: skus } })
      .populate('category', 'name')
      .lean();
    const masterBySku = {};
    masters.forEach(m => { masterBySku[normalizeSku(m.sku)] = m; });

    const mappedItems = items.map((item, index) => {
      const master = masterBySku[normalizeSku(item.sku)] || {};

      const name = item.name || master.name || item.sku || `Item-${index}`;
      const sku  = item.sku  || master.sku  || master.itemId || `ITEM-${index}`;
      const qty  = getQty(item);

      // Category
      let categoryName = null;
      if (item.category?.name)        categoryName = item.category.name;
      else if (master.category?.name) categoryName = master.category.name;
      else if (typeof item.category === 'string' && item.category) categoryName = item.category;

      // Status
      const rawStatus = item.status || 'Active';
      let status = 'Active';
      if (rawStatus === 'Dead'     || rawStatus === 'Inactive') status = 'Dead';
      else if (rawStatus === 'Critical' || rawStatus === 'Low Stock') status = 'Critical';
      else status = 'Active';

      // Warehouse — keep null/empty as null so the stats count is accurate
      const warehouseRaw = String(item.warehouse || '').trim();
      const warehouse = warehouseRaw || null;

      return {
        _id:             item._id,
        name,
        itemName:        name,
        sku,
        itemCode:        sku,
        qty,
        currentQuantity: qty,
        available:       qty,
        warehouse:       warehouse || 'Main Warehouse', // display fallback only
        warehouseRaw:    warehouse,                     // null when truly unset
        category:        categoryName,
        categoryName,
        status,
        unit:            item.unit || master.unit || 'Nos',
        unitPrice:       master.unitPrice || master.sellingPrice || 0,
      };
    });

    // Stats — count only items that have a real warehouse value
    const totalSKU      = mappedItems.length;
    const criticalItems = mappedItems.filter(i => i.status === 'Critical').length;
    const deadItems     = mappedItems.filter(i => i.status === 'Dead').length;
    const totalUnits    = mappedItems.reduce((s, i) => s + i.qty, 0);
    // Only count warehouses that actually exist in data (not the 'Main Warehouse' fallback)
    const warehouseSet  = new Set(mappedItems.map(i => i.warehouseRaw).filter(Boolean));
    const warehouses    = warehouseSet.size || 1; // at least 1 if any items exist

    console.log(`=== Stock response: ${totalSKU} items, ${warehouses} warehouses ===`);

    res.json({
      success: true,
      data: mappedItems,
      statistics: {
        totalSKU,
        criticalItems,
        deadItems,
        totalUnits,
        warehouses,
      },
    });
  } catch (error) {
    console.error('getDealerInventoryStock error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch inventory stock' });
  }
};

// Get overall inventory (kept for backward compatibility)
export const getDealerInventory = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const sku = normalizeSku(req.query.sku);
    const warehouseId = String(req.query.warehouseId || '').trim();
    const inStock = String(req.query.inStock || '').toLowerCase() === 'true';

    const match = {};
    if (sku) match.sku = sku;
    if (warehouseId) match.warehouse = warehouseId;

    if (search) {
      match.$or = [
        { sku: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
      ];
    }

    const inventory = await InventoryItem.find(match);

    const grouped = {};
    for (const inv of inventory) {
      const key = normalizeSku(inv.sku);
      const qty = getQty(inv);
      if (!grouped[key]) grouped[key] = { _id: key, qty: 0 };
      grouped[key].qty += qty;
    }

    const rows = Object.values(grouped).map(mapInventoryRow).filter((r) => (inStock ? r.availableQty > 0 : true));
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch inventory' });
  }
};

export const getDealerProductInventory = async (req, res) => {
  try {
    const product = await ItemMaster.findById(req.params.productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const sku = normalizeSku(product.sku);
    const inventory = await InventoryItem.find({ sku });

    let totalAvailable = 0;
    const byGodown = [];
    const byPincode = {};

    for (const inv of inventory) {
      const qty = getQty(inv);
      totalAvailable += qty;

      const godownId = inv.warehouse || '';
      const godownName = inv.warehouse || '';

      if (godownId) {
        byGodown.push({
          warehouseId: godownId,
          name: godownName,
          pincode: '',
          city: '',
          qty,
        });
      }
    }

    res.json({
      success: true,
      data: {
        productId: product._id,
        sku,
        totalAvailable,
        byGodown,
        byPincode: Object.values(byPincode),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch product inventory' });
  }
};

export const checkDealerAvailability = async (req, res) => {
  try {
    const product = await ItemMaster.findById(req.body.productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const sku = normalizeSku(product.sku);
    const requested = parseInt(req.body.quantity, 10) || 0;
    if (requested <= 0) return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });

    const rows = await InventoryItem.aggregate([
      { $match: { sku } },
      {
        $group: {
          _id: '$sku',
          qty: { $sum: { $ifNull: ['$qty', 0] } }
        },
      },
    ]);

    const available = rows[0]?.qty || 0;
    res.json({
      success: true,
      data: {
        sku,
        requestedQty: requested,
        availableQty: available,
        available: available >= requested,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to check availability' });
  }
};

export const getDealerPincodeStock = async (req, res) => {
  try {
    const pincodeFilter = String(req.query.pincode || '').trim();
    const inventory = await InventoryItem.find()
      .populate('category', 'name');

    const pincodeMap = {};

    for (const item of inventory) {
      if (!item) continue;

      const pincode = '';
      const city = '';

      if (pincodeFilter && pincode !== pincodeFilter) continue;

      const key = pincode || 'Unknown';
      if (!pincodeMap[key]) {
        pincodeMap[key] = { pincode, city, godowns: {} };
      }

      const godownId = String(item.warehouse || 'DEFAULT');
      if (!pincodeMap[key].godowns[godownId]) {
        pincodeMap[key].godowns[godownId] = {
          id: godownId,
          name: String(item.warehouse || 'Default Godown'),
          locations: [],
        };
      }

      pincodeMap[key].godowns[godownId].locations.push({
        sku: String(item.sku || 'N/A'),
        name: String(item.name || 'Unknown Item'),
        qty: getQty(item),
        loc: '',
      });
    }

    const pincodeData = Object.values(pincodeMap).map((p) => ({
      pincode: String(p.pincode || ''),
      city: String(p.city || ''),
      godowns: Object.values(p.godowns || {}).map((g) => ({
        id: String(g.id || ''),
        name: String(g.name || ''),
        locations: Array.isArray(g.locations) ? g.locations : [],
      })),
    }));

    res.json({ success: true, data: pincodeData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch pincode stock' });
  }
};

