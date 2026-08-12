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

// Get full inventory stock for the Dealer App
// PRIMARY source: ItemMaster (real Tally-imported items with proper names)
// STOCK qty:      aggregated from InventoryItem by SKU
export const getDealerInventoryStock = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();

    console.log('=== getDealerInventoryStock called (ItemMaster primary) ===');

    // ── 1. Fetch from ItemMaster — the real Tally-imported catalog ────────────
    const masterFilter = { isActive: true };
    if (search) {
      masterFilter.$or = [
        { name:   { $regex: search, $options: 'i' } },
        { sku:    { $regex: search, $options: 'i' } },
        { itemId: { $regex: search, $options: 'i' } },
      ];
    }

    const masters = await ItemMaster.find(masterFilter)
      .populate('category', 'name')
      .lean();

    console.log(`Found ${masters.length} ItemMaster records`);

    // ── 2. Get stock quantities from InventoryItem aggregated by SKU ──────────
    const skus = masters.map(m => String(m.sku || '').toUpperCase()).filter(Boolean);
    const stockAgg = await InventoryItem.aggregate([
      { $match: { sku: { $in: skus } } },
      { $group: { _id: '$sku', qty: { $sum: { $ifNull: ['$qty', 0] } }, unit: { $first: '$unit' } } },
    ]);
    const stockMap = {};
    stockAgg.forEach(r => { stockMap[String(r._id).toUpperCase()] = r.qty || 0; });

    // ── 3. Map to unified shape ───────────────────────────────────────────────
    const mappedItems = masters.map(master => {
      const sku = String(master.sku || master.itemId || '').toUpperCase();
      const qty = stockMap[sku] || 0;

      const categoryName = master.category?.name || null;

      // Status from stock level
      let status = 'Active';
      if (qty <= 0) status = 'Dead';
      else if (master.reorderPoint > 0 && qty <= master.reorderPoint) status = 'Critical';

      return {
        _id:          master._id,
        id:           master._id,
        name:         master.name,
        itemName:     master.name,
        sku:          sku,
        itemCode:     sku,
        qty,
        currentQuantity: qty,
        available:    qty,
        stock:        qty,
        category:     categoryName,
        categoryName,
        status,
        unit:         master.unit || 'Nos',
        unitPrice:    master.unitPrice    || master.sellingPrice || 0,
        sellingPrice: master.sellingPrice || master.unitPrice    || 0,
        price:        master.unitPrice    || master.sellingPrice || 0,
        gst:          master.gst          || 0,
        gstPercent:   master.gst          || 0,
        hsn:          master.hsn          || '',
        moq:          master.minQuantity  || 1,
        dataSource:   master.dataSource   || 'ERP',
      };
    });

    const totalSKU      = mappedItems.length;
    const criticalItems = mappedItems.filter(i => i.status === 'Critical').length;
    const deadItems     = mappedItems.filter(i => i.status === 'Dead').length;
    const totalUnits    = mappedItems.reduce((s, i) => s + i.qty, 0);

    console.log(`=== Stock response: ${totalSKU} items from ItemMaster ===`);

    res.json({
      success: true,
      data: mappedItems,
      statistics: { totalSKU, criticalItems, deadItems, totalUnits },
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

