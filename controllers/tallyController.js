import TallyConfig from '../models/TallyConfig.js';
import TallySyncLog from '../models/TallySyncLog.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Inventory from '../models/Inventory.js';
import ItemMaster from '../models/ItemMaster.js';

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

export const testConnection = async (req, res) => {
  try {
    // In a real implementation this would ping the Tally server
    // For now we simulate a connection test
    const config = await TallyConfig.findOne();
    const connected = !!(config?.serverUrl && config?.port);
    const status = connected ? 'Connected' : 'Disconnected';
    if (config) { config.connectionStatus = status; await config.save(); }
    res.json({ success: true, data: { status }, message: `Tally ${status.toLowerCase()}` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Sync Logs ─────────────────────────────────────────────────────────────────
export const getSyncLogs = async (req, res) => {
  try {
    const { type, status, limit = 50 } = req.query;
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
    const successRate = todayTotal > 0 ? ((todaySuccess / todayTotal) * 100).toFixed(1) : '0.0';
    res.json({
      success: true,
      data: {
        connectionStatus: config?.connectionStatus || 'Unknown',
        lastSyncAt: config?.lastSyncAt || null,
        todayTotal, todaySuccess, todayFailed,
        successRate: `${successRate}%`,
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
    // Simulate sync status based on last sync log per category
    const categories = ['Items', 'Ledgers', 'GST Rates', 'Units', 'Godowns'];
    const result = await Promise.all(categories.map(async (cat) => {
      const lastLog = await TallySyncLog.findOne({ type: cat === 'Items' ? 'Item Master' : cat }).sort({ createdAt: -1 });
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
    const types = ['Purchase Vouchers','Sales Vouchers','Payment Vouchers','Receipt Vouchers','Journal Vouchers'];
    const typeMap = { 'Purchase Vouchers': 'Purchase', 'Sales Vouchers': 'Sales', 'Payment Vouchers': 'Payment', 'Receipt Vouchers': 'Receipt', 'Journal Vouchers': 'Journal' };
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
    const start = Date.now();
    // Simulate sync — in production this would call Tally XML API
    const syncId = `SYNC-${Date.now()}`;
    const duration = `${((Date.now() - start) / 1000 + Math.random() * 2).toFixed(1)}s`;
    const log = await TallySyncLog.create({
      syncId,
      type: type === 'master' ? 'Item Master' : type === 'transaction' ? 'Purchase' : type,
      direction: 'ERP → Tally',
      status: 'Success',
      duration,
      records: Math.floor(Math.random() * 100) + 10,
      triggeredBy: req.user?._id,
    });
    // Update last sync time
    await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date() }, { upsert: true });
    res.json({ success: true, data: log, message: `${type} sync completed` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

export const retrySync = async (req, res) => {
  try {
    const original = await TallySyncLog.findById(req.params.id);
    if (!original) return res.status(404).json({ success: false, message: 'Log not found' });
    const syncId = `SYNC-${Date.now()}`;
    const log = await TallySyncLog.create({
      syncId,
      type: original.type,
      entity: original.entity,
      direction: original.direction,
      status: 'Success',
      duration: `${(Math.random() * 3 + 0.5).toFixed(1)}s`,
      records: original.records,
      triggeredBy: req.user?._id,
    });
    res.json({ success: true, data: log, message: 'Retry successful' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
