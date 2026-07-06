import GRN from '../models/GRN.js';
import Inventory from '../models/Inventory.js';
import InventoryItem from '../models/InventoryItem.js';
import StockMovement from '../models/StockMovement.js';
import Batch from '../models/Batch.js';
import QualityCheck from '../models/QualityCheck.js';
import MaterialReturn from '../models/MaterialReturn.js';

/**
 * Get comprehensive inventory flow data for dashboard
 * Shows: GRN → Inventory Increase → Sales → Inventory Decrease → Production → +/- Inventory → Return → Inventory Increase
 * Uses InventoryItem as the primary stock source (main collection used throughout the app).
 * Falls back to Inventory model records and merges them in when present.
 */
export const getInventoryFlowDashboard = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 1. GRN Data - Goods Received
    const grns = await GRN.find()
      .populate('vendorId', 'companyName')
      .populate('poId', 'poId')
      .sort({ createdAt: -1 });

    const grnStats = {
      total: grns.length,
      today: grns.filter(g => new Date(g.createdAt) >= today && new Date(g.createdAt) < tomorrow).length,
      pending: grns.filter(g => g.grnStatus === 'Received' || g.grnStatus === 'QC_Pending').length,
      qcApproved: grns.filter(g => g.grnStatus === 'QC_Approved').length,
      inventoryUpdated: grns.filter(g => g.grnStatus === 'Inventory_Updated').length,
      totalQuantity: grns.reduce((sum, g) => sum + (g.receivedQuantity || 0), 0),
      acceptedQuantity: grns.reduce((sum, g) => sum + (g.acceptedQuantity || 0), 0),
    };

    // 2. Inventory Data - use InventoryItem as primary source (used across the whole app).
    //    Also query the Inventory model (GRN-converted stock) and merge unique SKUs.
    const [rawInventoryItems, rawInventory] = await Promise.all([
      InventoryItem.find(),
      Inventory.find().populate('warehouse', 'name'),
    ]);

    // Normalise InventoryItem to a common shape
    const normaliseItem = (i) => ({
      sku: i.sku || i.itemCode || '',
      name: i.name || i.itemName || '',
      status: i.status || 'Active',
      totalQty: i.qty ?? i.currentQuantity ?? 0,
      availableQty: Math.max(0, (i.qty ?? i.currentQuantity ?? 0) - (i.reservedQuantity || 0)),
      reservedQty: i.reservedQuantity || 0,
      minQty: i.minQty ?? i.reorderPoint ?? 0,
      unitPrice: i.unitPrice || 0,
      warehouse: typeof i.warehouse === 'string' ? i.warehouse : (i.warehouse?.name || 'Main Warehouse'),
    });

    const normaliseInventory = (i) => ({
      sku: i.sku || '',
      name: i.name || '',
      status: i.status || 'Active',
      totalQty: i.totalQuantity || 0,
      availableQty: i.availableQuantity || 0,
      reservedQty: i.reservedQuantity || 0,
      minQty: i.minQuantity || 0,
      unitPrice: i.unitPrice || 0,
      warehouse: i.warehouse?.name || 'Main Warehouse',
    });

    // Merge: InventoryItem records are authoritative; supplement with any Inventory
    // records whose SKU is not already present in InventoryItem.
    const itemSkus = new Set(rawInventoryItems.map(i => (i.sku || i.itemCode || '').toUpperCase()));
    const extraFromInventory = rawInventory.filter(i => i.sku && !itemSkus.has(i.sku.toUpperCase()));
    const allItems = [
      ...rawInventoryItems.map(normaliseItem),
      ...extraFromInventory.map(normaliseInventory),
    ];

    const inventoryStats = {
      total: allItems.length,
      active: allItems.filter(i => i.status === 'Active').length,
      critical: allItems.filter(i => i.status === 'Critical').length,
      dead: allItems.filter(i => i.status === 'Dead').length,
      totalQuantity: allItems.reduce((sum, i) => sum + i.totalQty, 0),
      availableQuantity: allItems.reduce((sum, i) => sum + i.availableQty, 0),
      reservedQuantity: allItems.reduce((sum, i) => sum + i.reservedQty, 0),
      totalValue: allItems.reduce((sum, i) => sum + (i.totalQty * i.unitPrice), 0),
    };

    // 3. Stock Movements - Track all inventory changes
    const movements = await StockMovement.find()
      .sort({ createdAt: -1 });

    const movementStats = {
      total: movements.length,
      today: movements.filter(m => new Date(m.createdAt) >= today && new Date(m.createdAt) < tomorrow).length,
      inward: movements.filter(m => m.type === 'Inward').length,
      outward: movements.filter(m => m.type === 'Outward').length,
      transfer: movements.filter(m => m.type === 'Transfer').length,
      inwardToday: movements.filter(m => m.type === 'Inward' && new Date(m.createdAt) >= today && new Date(m.createdAt) < tomorrow).length,
      outwardToday: movements.filter(m => m.type === 'Outward' && new Date(m.createdAt) >= today && new Date(m.createdAt) < tomorrow).length,
      inwardQty: movements.filter(m => m.type === 'Inward').reduce((sum, m) => sum + (m.qty || 0), 0),
      outwardQty: movements.filter(m => m.type === 'Outward').reduce((sum, m) => sum + (m.qty || 0), 0),
    };

    // 4. Batch Data - Track batches from GRN
    const batches = await Batch.find()
      .populate('grnId', 'grnId')
      .populate('vendorId', 'companyName');

    const batchStats = {
      total: batches.length,
      active: batches.filter(b => b.status === 'Active').length,
      critical: batches.filter(b => b.status === 'Critical').length,
      expired: batches.filter(b => b.status === 'Expired').length,
      totalQuantity: batches.reduce((sum, b) => sum + (b.quantity || 0), 0),
    };

    // 5. Quality Check Data
    const qcRecords = await QualityCheck.find()
      .populate('grnId', 'grnId')
      .sort({ createdAt: -1 });

    const qcStats = {
      total: qcRecords.length,
      pending: qcRecords.filter(q => q.status === 'Pending').length,
      passed: qcRecords.filter(q => q.status === 'Passed').length,
      partial: qcRecords.filter(q => q.status === 'Partial').length,
      rejected: qcRecords.filter(q => q.status === 'Rejected').length,
    };

    // 6. Material Returns - Track returns
    const returns = await MaterialReturn.find()
      .sort({ createdAt: -1 });

    const returnStats = {
      total: returns.length,
      today: returns.filter(r => new Date(r.createdAt) >= today && new Date(r.createdAt) < tomorrow).length,
      pending: returns.filter(r => r.stage === 'Initiated' || r.stage === 'In-transit').length,
      approved: returns.filter(r => r.stage === 'Received' || r.stage === 'QC').length,
      totalQuantity: returns.reduce((sum, r) => sum + (r.items || 0), 0),
    };

    // 7. Inventory Flow Timeline - Show the complete flow
    const flowTimeline = {
      grnReceived: grnStats.today,
      inventoryIncreased: inventoryStats.totalQuantity,
      salesOutward: movementStats.outwardToday,
      productionUsage: movements
        .filter(m => m.type === 'Outward' && m.ref && m.ref.includes('PROD'))
        .reduce((sum, m) => sum + (m.qty || 0), 0),
      returnsInward: returnStats.today,
      finalStock: inventoryStats.availableQuantity,
    };

    // 8. Warehouse-wise breakdown (allItems uses normalised shape)
    const warehouseBreakdown = {};
    allItems.forEach(item => {
      const whName = item.warehouse || 'Main Warehouse';
      if (!warehouseBreakdown[whName]) {
        warehouseBreakdown[whName] = {
          items: 0,
          totalQty: 0,
          availableQty: 0,
          reservedQty: 0,
          value: 0,
        };
      }
      warehouseBreakdown[whName].items += 1;
      warehouseBreakdown[whName].totalQty += item.totalQty;
      warehouseBreakdown[whName].availableQty += item.availableQty;
      warehouseBreakdown[whName].reservedQty += item.reservedQty;
      warehouseBreakdown[whName].value += item.totalQty * item.unitPrice;
    });

    // 9. Recent GRN to Inventory conversions
    const recentConversions = grns
      .filter(g => g.grnStatus === 'Inventory_Updated' && g.inventoryId)
      .slice(0, 10)
      .map(g => ({
        grnId: g.grnId,
        vendor: g.vendorId?.companyName,
        receivedQty: g.receivedQuantity,
        acceptedQty: g.acceptedQuantity,
        status: g.grnStatus,
        date: g.createdAt,
      }));

    // 10. Low stock items (from normalised allItems)
    const lowStockItems = allItems
      .filter(i => i.status === 'Critical' || (i.minQty > 0 && i.availableQty < i.minQty))
      .slice(0, 10)
      .map(i => ({
        sku: i.sku,
        name: i.name,
        available: i.availableQty,
        minimum: i.minQty,
        warehouse: i.warehouse,
        status: i.status,
      }));

    res.json({
      success: true,
      data: {
        grnStats,
        inventoryStats,
        movementStats,
        batchStats,
        qcStats,
        returnStats,
        flowTimeline,
        warehouseBreakdown,
        recentConversions,
        lowStockItems,
        timestamp: new Date(),
      },
    });
  } catch (err) {
    console.error('Error fetching inventory flow dashboard:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Get detailed inventory flow for a specific GRN
 */
export const getGRNInventoryFlow = async (req, res) => {
  try {
    const { grnId } = req.params;

    const grn = await GRN.findById(grnId)
      .populate('vendorId', 'companyName')
      .populate('poId', 'poId')
      .populate('batchId')
      .populate('inventoryId');

    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Get related inventory items
    const inventoryItems = await Inventory.find({ grnId })
      .populate('warehouse', 'name');

    // Get related movements
    const movements = await StockMovement.find({ ref: grn.grnId })
      .sort({ createdAt: -1 });

    // Get related batches
    const batches = await Batch.find({ grnId });

    // Get QC records
    const qcRecords = await QualityCheck.find({ grnId });

    res.json({
      success: true,
      data: {
        grn,
        inventoryItems,
        movements,
        batches,
        qcRecords,
      },
    });
  } catch (err) {
    console.error('Error fetching GRN inventory flow:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Get inventory movement trends
 */
export const getInventoryTrends = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const movements = await StockMovement.find({
      createdAt: { $gte: startDate },
    }).sort({ createdAt: 1 });

    // Group by date and type
    const trendData = {};
    movements.forEach(m => {
      const date = new Date(m.createdAt).toLocaleDateString('en-IN');
      if (!trendData[date]) {
        trendData[date] = { inward: 0, outward: 0, transfer: 0 };
      }
      trendData[date][m.type.toLowerCase()] += m.qty || 0;
    });

    const trends = Object.entries(trendData).map(([date, data]) => ({
      date,
      ...data,
    }));

    res.json({
      success: true,
      data: trends,
    });
  } catch (err) {
    console.error('Error fetching inventory trends:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
