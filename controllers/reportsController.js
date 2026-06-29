import SalesOrder from '../models/SalesOrder.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import InventoryItem from '../models/InventoryItem.js';
import WorkOrder from '../models/WorkOrder.js';
import MaterialReturn from '../models/MaterialReturn.js';
import CreditNote from '../models/CreditNote.js';
import GRN from '../models/GRN.js';
import Vendor from '../models/Vendor.js';

// ── Sales Analytics ───────────────────────────────────────────────────────────
export const getSalesAnalytics = async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const orders = await SalesOrder.find({
      orderDate: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) },
    });
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const byMonth = months.map((label, i) => ({
      label,
      value: orders.filter(o => new Date(o.orderDate).getMonth() === i)
                   .reduce((s, o) => s + (o.value || 0), 0),
    }));
    const byCustomer = {};
    orders.forEach(o => { byCustomer[o.customer] = (byCustomer[o.customer] || 0) + (o.value || 0); });
    const topCustomers = Object.entries(byCustomer)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([label, value]) => ({ label, value }));
    const totalRevenue = orders.reduce((s, o) => s + (o.value || 0), 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const topCustomer = topCustomers[0]?.label || '—';
    res.json({ success: true, data: { byMonth, topCustomers, totalRevenue, totalOrders, avgOrderValue, topCustomer } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Stock Summary ─────────────────────────────────────────────────────────────
export const getStockSummary = async (req, res) => {
  try {
    const { warehouse } = req.query;
    const filter = {};
    if (warehouse && warehouse !== 'All Warehouses') filter.warehouse = warehouse;

    const items = await InventoryItem.find(filter)
      .populate('category', 'name')
      .populate('itemMasterId', 'unitPrice costPrice sellingPrice')
      .sort({ sku: 1 });

    const mapped = items.map(item => {
      // Prefer unitPrice from linked ItemMaster, fall back to InventoryItem's own unitPrice
      const masterUnitPrice =
        item.itemMasterId?.unitPrice ||
        item.itemMasterId?.costPrice ||
        item.unitPrice ||
        0;

      const totalQty      = item.qty ?? item.currentQuantity ?? 0;
      const reserved      = item.reservedQuantity ?? 0;
      const available     = Math.max(0, totalQty - reserved);
      const minQty        = item.minQty ?? item.reorderPoint ?? 0;
      const totalValue    = parseFloat((totalQty * masterUnitPrice).toFixed(2));

      // Re-derive status based on live quantities
      let status = item.status || 'Active';
      if (totalQty === 0) status = 'Dead';
      else if (available <= minQty) status = 'Critical';
      else status = 'Active';

      return {
        _id:               item._id,
        sku:               item.sku || item.itemCode || '—',
        name:              item.name || item.itemName || '—',
        category:          item.category,
        warehouse:         item.warehouse,
        totalQuantity:     totalQty,
        availableQuantity: available,
        reservedQuantity:  reserved,
        incomingQuantity:  item.incomingQuantity ?? 0,
        minQuantity:       minQty,
        unit:              item.unit || 'Nos',
        unitPrice:         masterUnitPrice,
        totalValue,
        status,
      };
    });

    res.json({ success: true, data: mapped });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Inventory Turnover ────────────────────────────────────────────────────────
export const getInventoryTurnover = async (req, res) => {
  try {
    const items = await InventoryItem.find().populate('category', 'name');
    const result = items.map(item => {
      const closing = item.qty || 0;
      const opening = closing + Math.floor(closing * 0.2); // estimate
      const sold = Math.max(0, opening - closing);
      const avg = (opening + closing) / 2 || 1;
      const ratio = (sold / avg).toFixed(1);
      const status = parseFloat(ratio) === 0 ? 'Dead' : parseFloat(ratio) > 4 ? 'Fast Moving' : 'Good';
      return { sku: item.sku, name: item.name, openingStock: opening, closingStock: closing, sold, turnover: `${ratio}x`, status };
    });
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Purchase Register ─────────────────────────────────────────────────────────
export const getPurchaseRegister = async (req, res) => {
  try {
    const { month } = req.query; // format: YYYY-MM
    let filter = {};
    if (month) {
      const [y, m] = month.split('-');
      filter.createdAt = {
        $gte: new Date(`${y}-${m}-01`),
        $lte: new Date(new Date(`${y}-${m}-01`).setMonth(parseInt(m))),
      };
    }
    const pos = await PurchaseOrder.find(filter)
      .populate('vendor', 'companyName')
      .sort({ createdAt: -1 });
    const result = pos.map(po => {
      const taxable = po.subtotal || 0;
      const gst = po.gstTotal || taxable * 0.18;
      const cgst = gst / 2; const sgst = gst / 2;
      return {
        _id: po._id,
        poId: po.poId,
        date: new Date(po.createdAt).toLocaleDateString('en-IN'),
        vendor: po.vendor?.companyName || '—',
        items: Array.isArray(po.items) ? po.items.length : 0,
        taxable, cgst, sgst, igst: 0,
        total: po.grandTotal || (taxable + gst),
        grnStatus: po.status || 'Pending',
      };
    });
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Production Report ─────────────────────────────────────────────────────────
export const getProductionReport = async (req, res) => {
  try {
    const { month } = req.query;
    let filter = {};
    if (month) {
      const [y, m] = month.split('-');
      filter.createdAt = {
        $gte: new Date(`${y}-${m}-01`),
        $lte: new Date(new Date(`${y}-${m}-01`).setMonth(parseInt(m))),
      };
    }
    const wos = await WorkOrder.find(filter).populate('bomId', 'bomId product');
    const totalProduced = wos.reduce((s, w) => s + (w.produced || 0), 0);
    const totalRejected = wos.reduce((s, w) => s + (w.rejected || 0), 0);
    const totalTarget = wos.reduce((s, w) => s + (w.qty || 0), 0);
    const efficiency = totalTarget > 0 ? Math.round((totalProduced / totalTarget) * 100) : 0;
    const rejectionRate = totalProduced > 0 ? ((totalRejected / (totalProduced + totalRejected)) * 100).toFixed(1) : '0.0';
    res.json({
      success: true,
      data: {
        workOrders: wos,
        summary: { totalProduced, totalRejected, totalTarget, efficiency, rejectionRate: `${rejectionRate}%` },
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Return Reconciliation ─────────────────────────────────────────────────────
export const getReturnReconciliation = async (req, res) => {
  try {
    const returns = await MaterialReturn.find().sort({ createdAt: -1 });
    const creditNotes = await CreditNote.find();
    const cnMap = {};
    // CreditNote.against stores the MR ID string reference
    creditNotes.forEach(cn => { if (cn.against) cnMap[cn.against] = cn.cnId; });
    const result = returns.map(r => ({
      _id: r._id,
      mrId: r.mrId,
      docketId: r.docketId,
      customer: r.supplierName,
      returnType: r.returnType || 'Defective',
      value: r.value || 0,
      creditNote: r.creditNoteId || cnMap[r.mrId] || null,
      stage: r.stage,
      reconciled: (r.creditNoteId || cnMap[r.mrId]) ? 'Yes' : r.stage === 'Closed' ? 'No' : 'Pending',
    }));
    const totalValue = result.reduce((s, r) => s + r.value, 0);
    const creditIssued = result.filter(r => r.creditNote).length;
    res.json({ success: true, data: { returns: result, summary: { total: result.length, totalValue, creditIssued } } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
