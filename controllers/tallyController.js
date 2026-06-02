import TallyConfig from '../models/TallyConfig.js';
import TallySyncLog from '../models/TallySyncLog.js';
import TallyVoucher from '../models/TallyVoucher.js';
import ItemMaster from '../models/ItemMaster.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Invoice from '../models/Invoice.js';
import Vendor from '../models/Vendor.js';
import Client from '../models/Client.js';
import AccountsLedger from '../models/AccountsLedger.js';
import {
  testTallyConnection,
  runTargetedSync,
  runFullSync,
} from '../services/tallyService.js';
// ── Config ────────────────────────────────────────────────────────────────────
export const getConfig = async (req, res) => {
  try {
    let config = await TallyConfig.findOne();
    if (!config) config = await TallyConfig.create({});
    res.json({ success: true, data: config });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

export const saveConfig = async (req, res) => {
  try {
    let config = await TallyConfig.findOne();
    if (!config) config = new TallyConfig();
    Object.assign(config, req.body);
    config.updatedBy = req.user?._id;
    await config.save();
    res.json({ success: true, data: config, message: 'Configuration saved' });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

// ── Fix existing config direction (one-time) ──────────────────────────────────
export const fixConfig = async (req, res) => {
  try {
    const result = await TallyConfig.findOneAndUpdate(
      { syncDirection: 'ERP → Tally' },
      { $set: { syncDirection: 'Bi-directional' } },
      { new: true }
    );
    res.json({ success: true, updated: !!result, data: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

export const testConnection = async (req, res) => {
  try {
    const result = await testTallyConnection();
    const connected = result.status === 'Connected';
    res.json({
      success: true,
      data: {
        status         : result.status,
        error          : result.error || null,
        url            : result.url,
        httpStatus     : result.httpStatus || null,
        requestMethod  : result.requestMethod,
        requestBody    : result.requestBody,
        responsePreview: result.responsePreview || null,
      },
      message: connected
        ? `Connected — POST ${result.url} → HTTP ${result.httpStatus || '2xx'}`
        : `Not reachable — ${result.error}`,
    });
  } catch (e) {
    console.error('[TallyController] testConnection error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── Sync Logs ─────────────────────────────────────────────────────────────────
export const getSyncLogs = async (req, res) => {
  try {
    const { type, status, limit = 100 } = req.query;
    const filter = {};
    if (type && type !== 'All Types') filter.type = type;
    if (status && status !== 'All Status') filter.status = status;
    const logs = await TallySyncLog.find(filter)
      .populate('triggeredBy', 'name')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    res.json({ success: true, data: logs });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Sync Stats ────────────────────────────────────────────────────────────────
export const getSyncStats = async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [todayTotal, todaySuccess, todayFailed, config] = await Promise.all([
      TallySyncLog.countDocuments({ createdAt: { $gte: today } }),
      TallySyncLog.countDocuments({ createdAt: { $gte: today }, status: 'Success' }),
      TallySyncLog.countDocuments({ createdAt: { $gte: today }, status: 'Failed' }),
      TallyConfig.findOne(),
    ]);

    // Auto-probe connection if status is Unknown or last check was >5 min ago
    let connectionStatus = config?.connectionStatus || 'Unknown';
    const stale = !config?.updatedAt || (Date.now() - new Date(config.updatedAt).getTime() > 5 * 60 * 1000);
    if (connectionStatus === 'Unknown' || stale) {
      try {
        const probe = await testTallyConnection();
        connectionStatus = probe.status;
      } catch (_) { /* non-fatal */ }
    }

    const successRate = todayTotal > 0 ? ((todaySuccess / todayTotal) * 100).toFixed(1) : '0.0';
    res.json({
      success: true,
      data: {
        connectionStatus,
        lastSyncAt: config?.lastSyncAt || null,
        todayTotal, todaySuccess, todayFailed,
        successRate: `${successRate}%`,
        syncDirection: config?.syncDirection || 'Bi-directional',
        autoSync: config?.autoSync || false,
        syncInterval: config?.syncInterval || 'Every 15 minutes',
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Master Data Status ────────────────────────────────────────────────────────
export const getMasterDataStatus = async (req, res) => {
  try {
    const [itemCount, poCount] = await Promise.all([
      ItemMaster.countDocuments({ isActive: true }),
      PurchaseOrder.countDocuments(),
    ]);
    const categories = ['Items', 'Ledgers', 'GST Rates', 'Units', 'Godowns'];
    const result = await Promise.all(categories.map(async (cat) => {
      const logType = cat === 'Items' ? 'Item Master' : cat === 'Ledgers' ? 'Ledger' : cat;
      const lastLog = await TallySyncLog.findOne({ type: logType }).sort({ createdAt: -1 });
      const total = cat === 'Items' ? itemCount : cat === 'Ledgers' ? poCount : 8;
      const failed = lastLog?.status === 'Failed' ? 1 : 0;
      return {
        category: cat,
        total,
        synced: total - failed,
        pending: 0,
        failed,
        lastSync: lastLog ? new Date(lastLog.createdAt).toLocaleString('en-IN') : 'Never',
        status: failed > 0 ? 'Partial' : lastLog ? 'Synced' : 'Pending',
      };
    }));
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Transaction Status ────────────────────────────────────────────────────────
export const getTransactionStatus = async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const types = ['Purchase Vouchers', 'Sales Vouchers', 'Payment Vouchers', 'Receipt Vouchers', 'Journal Vouchers'];
    const typeMap = {
      'Purchase Vouchers': 'Purchase', 'Sales Vouchers': 'Sales',
      'Payment Vouchers': 'Payment', 'Receipt Vouchers': 'Receipt', 'Journal Vouchers': 'Journal',
    };
    const result = await Promise.all(types.map(async (t) => {
      const logType = typeMap[t];
      const [todayLogs, lastLog] = await Promise.all([
        TallySyncLog.find({ type: logType, createdAt: { $gte: today } }),
        TallySyncLog.findOne({ type: logType }).sort({ createdAt: -1 }),
      ]);
      const synced = todayLogs.filter(l => l.status === 'Success').length;
      const failed = todayLogs.filter(l => l.status === 'Failed').length;
      const pending = todayLogs.filter(l => l.status === 'Partial').length;
      return {
        type: t,
        today: todayLogs.length,
        synced, pending, failed,
        lastSync: lastLog ? new Date(lastLog.createdAt).toLocaleString('en-IN') : 'Never',
        status: failed > 0 ? 'Failed' : pending > 0 ? 'Pending' : synced > 0 ? 'Synced' : 'Pending',
      };
    }));
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Trigger Sync ──────────────────────────────────────────────────────────────
export const triggerSync = async (req, res) => {
  try {
    const { type = 'Full' } = req.body;
    const result = await runTargetedSync(type, req.user?._id);

    // Tally is offline — return 200 with clear message (not a server error)
    if (result.offline) {
      return res.json({
        success: false,
        offline: true,
        data: result,
        message: result.error,
      });
    }

    const message = result.ok
      ? `${type} sync completed — ${result.records || 0} records processed`
      : `${type} sync completed with errors: ${result.error || 'unknown'}`;
    res.json({ success: result.ok, data: result, message });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

export const retrySync = async (req, res) => {
  try {
    const original = await TallySyncLog.findById(req.params.id);
    if (!original) return res.status(404).json({ success: false, message: 'Log not found' });
    const result = await runTargetedSync(original.type, req.user?._id);
    if (result.offline) {
      return res.json({ success: false, offline: true, data: result, message: result.error });
    }
    res.json({ success: result.ok, data: result, message: result.ok ? 'Retry successful' : `Retry failed: ${result.error}` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};


// ─── VOUCHERS (Payment & Receipt Management) ──────────────────────────────────

export const getVouchers = async (req, res) => {
  try {
    const { type, partyName, limit = 100 } = req.query;
    const filter = {};
    if (type) filter.voucherType = type;
    if (partyName) filter.partyName = new RegExp(partyName, 'i');
    const vouchers = await TallyVoucher.find(filter)
      .sort({ voucherDate: -1 })
      .limit(parseInt(limit));
    res.json({ success: true, data: vouchers });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

export const createVoucher = async (req, res) => {
  try {
    const voucher = await TallyVoucher.create({ ...req.body, source: 'ERP' });
    res.json({ success: true, data: voucher, message: 'Voucher created (will sync to Tally on next sync)' });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

export const deleteVoucher = async (req, res) => {
  try {
    await TallyVoucher.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Voucher deleted' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── GUID STATUS ──────────────────────────────────────────────────────────────

export const getGuidStatus = async (req, res) => {
  try {
    const [items, vendors, clients, ledgers, invoices, pos] = await Promise.all([
      ItemMaster.countDocuments({ tallyGuid: { $exists: true } }),
      Vendor.countDocuments({ tallyGuid: { $exists: true } }),
      Client.countDocuments({ tallyGuid: { $exists: true } }),
      AccountsLedger.countDocuments({ tallyGuid: { $exists: true } }),
      Invoice.countDocuments({ tallyGuid: { $exists: true } }),
      PurchaseOrder.countDocuments({ tallyGuid: { $exists: true } }),
    ]);
    const [itemsTotal, vendorsTotal, clientsTotal, ledgersTotal, invoicesTotal, posTotal] = await Promise.all([
      ItemMaster.countDocuments({ isActive: true }),
      Vendor.countDocuments({}),
      Client.countDocuments({ status: 'Active' }),
      AccountsLedger.countDocuments({ isActive: true }),
      Invoice.countDocuments({}),
      PurchaseOrder.countDocuments({}),
    ]);
    res.json({
      success: true,
      data: {
        items: { synced: items, total: itemsTotal, percentage: itemsTotal ? ((items / itemsTotal) * 100).toFixed(1) : '0.0' },
        vendors: { synced: vendors, total: vendorsTotal, percentage: vendorsTotal ? ((vendors / vendorsTotal) * 100).toFixed(1) : '0.0' },
        clients: { synced: clients, total: clientsTotal, percentage: clientsTotal ? ((clients / clientsTotal) * 100).toFixed(1) : '0.0' },
        ledgers: { synced: ledgers, total: ledgersTotal, percentage: ledgersTotal ? ((ledgers / ledgersTotal) * 100).toFixed(1) : '0.0' },
        invoices: { synced: invoices, total: invoicesTotal, percentage: invoicesTotal ? ((invoices / invoicesTotal) * 100).toFixed(1) : '0.0' },
        purchaseOrders: { synced: pos, total: posTotal, percentage: posTotal ? ((pos / posTotal) * 100).toFixed(1) : '0.0' },
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
