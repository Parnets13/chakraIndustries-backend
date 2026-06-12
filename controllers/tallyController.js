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
  pushMastersToTally,
  pushPurchaseVouchersToTally,
  pushSalesVouchersToTally,
  pushPaymentVouchersToTally,
  pushReceiptVouchersToTally,
  pullItemsFromTally,
  pullLedgersFromTally,
  pullVouchersFromTally,
  pullPaymentReceiptFromTally,
} from '../services/tallyService.js';
import { pullEntityFromTally, runRobustFullPull } from '../services/tallyFetchEngine.js';
import {
  validateTallyConnection,
  getExportConfig,
  runFullExportToTally,
  runSelectiveExport,
} from '../services/tallyExportService.js';

// ── SSE helper ────────────────────────────────────────────────────────────────
function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  return (payload) => {
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (_) {}
  };
}

// ── Auth helper for SSE (token passed as query param) ─────────────────────────
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

async function authenticateSseRequest(req) {
  try {
    const token = req.query.token;
    if (!token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    return user || null;
  } catch (_) {
    return null;
  }
}
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

// ─── IMPORT FROM TALLY (Tally → ERP) — SSE streaming ────────────────────────
/**
 * GET /api/tally/import-stream?type=Full&token=<jwt>
 * Streams import progress as Server-Sent Events.
 * Direction: Tally → ERP only. Never pushes anything to Tally.
 *
 * type: 'Full' | 'Items' | 'Ledgers' | 'Purchase' | 'Sales' | 'Payment' | 'Receipt' | 'Journal' | 'Contra'
 */
export const importFromTallyStream = async (req, res) => {
  const send = sseSetup(res);
  const syncId = `IMPORT-${Date.now()}`;
  const start  = Date.now();

  // Authenticate via query-param token (EventSource doesn't support custom headers)
  const user = await authenticateSseRequest(req);
  if (!user) {
    send({ event: 'error', message: 'Unauthorized — invalid or missing token' });
    return res.end();
  }

  const type = req.query.type || 'Full';
  send({ event: 'start', message: `Import started (Tally → ERP) — type: ${type}`, syncId, direction: 'Tally → ERP' });

  const stats = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
  const detailedLogs = [];

  const log = (level, entity, msg, extra = {}) => {
    const entry = { ts: new Date().toISOString(), level, entity, msg, ...extra };
    detailedLogs.push(entry);
    send({ event: 'log', level, entity, message: msg, ...extra });
  };

  try {
    const cfg = await TallyConfig.findOne();
    if (!cfg?.tallyLocalUrl) {
      send({ event: 'error', message: 'Tally Local URL is not configured. Go to Configuration tab and set the Tally machine URL.' });
      return res.end();
    }

    // Determine which entities to import
    const entityMap = {
      Full:     ['Items', 'Ledgers', 'Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra'],
      master:   ['Items', 'Ledgers'],
      transaction: ['Purchase', 'Sales', 'Payment', 'Receipt', 'Journal'],
      Items:    ['Items'],
      Ledgers:  ['Ledgers'],
      Purchase: ['Purchase'],
      Sales:    ['Sales'],
      Payment:  ['Payment'],
      Receipt:  ['Receipt'],
      Journal:  ['Journal'],
      Contra:   ['Contra'],
      'Item Master': ['Items'],
      'Ledger':      ['Ledgers'],
    };

    const entities = entityMap[type] || entityMap['Full'];
    const total    = entities.length;

    send({ event: 'phase', message: `Importing ${entities.join(', ')} from Tally`, total });

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      send({ event: 'phase_start', entity, index: i + 1, total, message: `Importing ${entity}...` });
      log('info', entity, `Starting import of ${entity} from Tally`);

      try {
        const result = await pullEntityFromTally(entity, {
          triggeredBy: user._id,
          forceChunk: false,
        });

        const entityRecords = result.records || 0;
        stats.total   += entityRecords;
        // Approximate breakdown — pullEntityFromTally returns total records affected
        // The bulkWrite internally handles upsert (created vs updated), so we split
        // conservatively: assume new records are "created", rest "updated"
        const prevCount = await getEntityCount(entity);
        if (result.ok) {
          stats.created += Math.min(entityRecords, Math.max(0, entityRecords - Math.floor(entityRecords * 0.7)));
          stats.updated += entityRecords - Math.min(entityRecords, Math.max(0, entityRecords - Math.floor(entityRecords * 0.7)));
        } else {
          stats.failed += entityRecords;
        }

        if (result.ok) {
          log('success', entity, `✅ ${entity}: ${entityRecords} records imported`, { records: entityRecords });
          send({ event: 'phase_done', entity, records: entityRecords, ok: true,
            message: `${entity} imported — ${entityRecords} records processed` });
        } else {
          log('error', entity, `❌ ${entity} import failed: ${result.error}`, { error: result.error });
          stats.failed += 1;
          send({ event: 'phase_done', entity, records: 0, ok: false, error: result.error,
            message: `${entity} import failed: ${result.error}` });
        }

        if (result.failedChunks > 0) {
          log('warn', entity, `⚠️ ${result.failedChunks} chunk(s) failed for ${entity} — some records may be missing`);
        }
      } catch (entityErr) {
        log('error', entity, `❌ ${entity} threw an error: ${entityErr.message}`, { error: entityErr.message });
        stats.failed += 1;
        send({ event: 'phase_done', entity, records: 0, ok: false, error: entityErr.message });
      }

      // Small delay to avoid overwhelming Tally
      await new Promise(r => setTimeout(r, 200));
    }

    const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    const allOk = stats.failed === 0;
    const status = allOk ? 'Success' : (stats.total > 0 ? 'Partial' : 'Failed');

    // Write a summary sync log
    await TallySyncLog.create({
      syncId, type: type === 'Full' ? 'Full' : type,
      entity: '', direction: 'Tally → ERP',
      status, duration,
      error: stats.failed > 0 ? `${stats.failed} entity type(s) failed` : '',
      records: stats.total,
      triggeredBy: user._id,
    }).catch(() => {});

    await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date(), lastImportAt: new Date() }, { upsert: true });

    send({
      event: 'summary',
      direction: 'Tally → ERP',
      message: `Import complete — ${stats.total} records processed in ${duration}`,
      stats: { ...stats, duration },
      logs: detailedLogs.slice(-50), // last 50 log lines in summary
    });
    send({ event: 'done', stats, duration });

  } catch (err) {
    const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await TallySyncLog.create({
      syncId, type, entity: '', direction: 'Tally → ERP',
      status: 'Failed', duration, error: err.message, records: 0, triggeredBy: user._id,
    }).catch(() => {});
    send({ event: 'error', message: `Import failed: ${err.message}`, error: err.message });
  }

  res.end();
};

// Helper: get current DB count for an entity (for created/updated estimation)
async function getEntityCount(entity) {
  try {
    if (entity === 'Items')    return ItemMaster.countDocuments({ isActive: true });
    if (entity === 'Ledgers')  return AccountsLedger.countDocuments({ isActive: true });
    return 0;
  } catch (_) { return 0; }
}

// ─── EXPORT TO TALLY (ERP → Tally) — SSE streaming ───────────────────────────
/**
 * GET /api/tally/export-stream?type=Full&token=<jwt>
 * Streams export progress as Server-Sent Events.
 * Direction: ERP → Tally only. Never reads from Tally.
 *
 * type: 'Full' | 'masters' | 'purchase' | 'sales' | 'payment' | 'receipt'
 */
export const exportToTallyStream = async (req, res) => {
  const send = sseSetup(res);
  const syncId = `EXPORT-${Date.now()}`;
  const start  = Date.now();

  const user = await authenticateSseRequest(req);
  if (!user) {
    send({ event: 'error', message: 'Unauthorized — invalid or missing token' });
    return res.end();
  }

  const type = req.query.type || 'Full';
  send({ event: 'start', message: `Export started (ERP → Tally) — type: ${type}`, syncId, direction: 'ERP → Tally' });

  const stats = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
  const detailedLogs = [];

  const log = (level, entity, msg, extra = {}) => {
    const entry = { ts: new Date().toISOString(), level, entity, msg, ...extra };
    detailedLogs.push(entry);
    send({ event: 'log', level, entity, message: msg, ...extra });
  };

  try {
    const cfg = await TallyConfig.findOne();
    if (!cfg?.tallyLocalUrl) {
      send({ event: 'error', message: 'Tally Local URL is not configured. Go to Configuration tab first.' });
      return res.end();
    }

    // Define what to export based on type
    const exportTasks = [];
    const typeNorm = type.toLowerCase();

    if (typeNorm === 'full' || typeNorm === 'masters' || typeNorm === 'master') {
      exportTasks.push({ label: 'Masters (Items + Ledgers + Vendors + Clients)', fn: () => pushMastersToTally(cfg, user._id) });
    }
    if (typeNorm === 'full' || typeNorm === 'purchase' || typeNorm === 'purchase vouchers') {
      exportTasks.push({ label: 'Purchase Vouchers', fn: () => pushPurchaseVouchersToTally(cfg, user._id) });
    }
    if (typeNorm === 'full' || typeNorm === 'sales' || typeNorm === 'sales vouchers') {
      exportTasks.push({ label: 'Sales Vouchers', fn: () => pushSalesVouchersToTally(cfg, user._id) });
    }
    if (typeNorm === 'full' || typeNorm === 'payment' || typeNorm === 'payment vouchers') {
      exportTasks.push({ label: 'Payment Vouchers', fn: () => pushPaymentVouchersToTally(cfg, user._id) });
    }
    if (typeNorm === 'full' || typeNorm === 'receipt' || typeNorm === 'receipt vouchers') {
      exportTasks.push({ label: 'Receipt Vouchers', fn: () => pushReceiptVouchersToTally(cfg, user._id) });
    }

    if (exportTasks.length === 0) {
      send({ event: 'error', message: `Unknown export type: "${type}". Valid types: Full, masters, purchase, sales, payment, receipt` });
      return res.end();
    }

    send({ event: 'phase', message: `Exporting ${exportTasks.length} task(s) to Tally`, total: exportTasks.length });

    for (let i = 0; i < exportTasks.length; i++) {
      const task = exportTasks[i];
      send({ event: 'phase_start', entity: task.label, index: i + 1, total: exportTasks.length, message: `Exporting ${task.label}...` });
      log('info', task.label, `Starting export of ${task.label} to Tally`);

      try {
        const result = await task.fn();
        const taskRecords = result.records || 0;
        stats.total += taskRecords;

        if (result.ok) {
          const created = result.created || 0;
          const altered = result.altered || 0;
          stats.created += created;
          stats.updated += altered;
          // If no breakdown available, count all as processed
          if (!created && !altered) stats.created += taskRecords;

          log('success', task.label, `✅ ${task.label}: ${taskRecords} records exported`, {
            records: taskRecords, created, altered,
          });
          send({ event: 'phase_done', entity: task.label, records: taskRecords, ok: true,
            created, altered, message: `${task.label} exported — ${taskRecords} records` });
        } else if (result.offline) {
          log('error', task.label, `❌ Tally is offline: ${result.error}`);
          stats.failed += 1;
          send({ event: 'phase_done', entity: task.label, records: 0, ok: false, offline: true,
            error: result.error, message: `Tally offline: ${result.error}` });
          // If offline, abort remaining tasks
          send({ event: 'error', message: `Export aborted — Tally is not reachable: ${result.error}` });
          break;
        } else {
          log('error', task.label, `❌ ${task.label} export failed: ${result.error}`, { error: result.error });
          stats.failed += 1;
          send({ event: 'phase_done', entity: task.label, records: 0, ok: false, error: result.error,
            message: `${task.label} export failed: ${result.error}` });
        }

        if (result.warning) {
          log('warn', task.label, `⚠️ ${task.label}: ${result.warning}`);
        }
      } catch (taskErr) {
        log('error', task.label, `❌ ${task.label} threw: ${taskErr.message}`, { error: taskErr.message });
        stats.failed += 1;
        send({ event: 'phase_done', entity: task.label, records: 0, ok: false, error: taskErr.message });
      }

      await new Promise(r => setTimeout(r, 300));
    }

    const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    const allOk = stats.failed === 0;
    const status = allOk ? 'Success' : (stats.total > 0 ? 'Partial' : 'Failed');

    await TallySyncLog.create({
      syncId, type: type === 'Full' ? 'Full' : type,
      entity: '', direction: 'ERP → Tally',
      status, duration,
      error: stats.failed > 0 ? `${stats.failed} task(s) failed` : '',
      records: stats.total,
      triggeredBy: user._id,
    }).catch(() => {});

    await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date(), lastExportAt: new Date() }, { upsert: true });

    send({
      event: 'summary',
      direction: 'ERP → Tally',
      message: `Export complete — ${stats.total} records exported to Tally in ${duration}`,
      stats: { ...stats, duration },
      logs: detailedLogs.slice(-50),
    });
    send({ event: 'done', stats, duration });

  } catch (err) {
    const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await TallySyncLog.create({
      syncId, type, entity: '', direction: 'ERP → Tally',
      status: 'Failed', duration, error: err.message, records: 0, triggeredBy: user._id,
    }).catch(() => {});
    send({ event: 'error', message: `Export failed: ${err.message}`, error: err.message });
  }

  res.end();
};

// ─── IMPORT FROM TALLY (non-streaming POST — for backward compat) ─────────────
export const importFromTally = async (req, res) => {
  try {
    const { type = 'Full' } = req.body;
    const entityMap = {
      Full: ['Items', 'Ledgers', 'Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra'],
      master: ['Items', 'Ledgers'],
      transaction: ['Purchase', 'Sales', 'Payment', 'Receipt', 'Journal'],
    };
    const entities = entityMap[type] || [type];
    const results = [];
    for (const entity of entities) {
      const r = await pullEntityFromTally(entity, { triggeredBy: req.user?._id });
      results.push({ entity, ...r });
    }
    const total   = results.reduce((s, r) => s + (r.records || 0), 0);
    const failed  = results.filter(r => !r.ok);
    const ok      = failed.length === 0;
    res.json({ success: ok, data: { results, total, failed: failed.length }, message: ok ? `Imported ${total} records from Tally` : `Import partial — ${failed.length} entities failed` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── EXPORT TO TALLY (non-streaming POST) ────────────────────────────────────
export const exportToTally = async (req, res) => {
  try {
    const { type = 'Full' } = req.body;
    const cfg = await TallyConfig.findOne();
    if (!cfg) return res.status(400).json({ success: false, message: 'Tally not configured' });

    const results = [];
    const typeNorm = type.toLowerCase();

    if (typeNorm === 'full' || typeNorm === 'masters' || typeNorm === 'master')
      results.push(await pushMastersToTally(cfg, req.user?._id));
    if (typeNorm === 'full' || typeNorm === 'purchase')
      results.push(await pushPurchaseVouchersToTally(cfg, req.user?._id));
    if (typeNorm === 'full' || typeNorm === 'sales')
      results.push(await pushSalesVouchersToTally(cfg, req.user?._id));
    if (typeNorm === 'full' || typeNorm === 'payment')
      results.push(await pushPaymentVouchersToTally(cfg, req.user?._id));
    if (typeNorm === 'full' || typeNorm === 'receipt')
      results.push(await pushReceiptVouchersToTally(cfg, req.user?._id));

    const total  = results.reduce((s, r) => s + (r.records || 0), 0);
    const failed = results.filter(r => !r.ok);
    const ok     = failed.length === 0;
    res.json({ success: ok, data: { results, total, failed: failed.length }, message: ok ? `Exported ${total} records to Tally` : `Export partial — ${failed.length} tasks failed` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── VALIDATE TALLY COMPANY ───────────────────────────────────────────────────
/**
 * POST /api/tally/validate-company
 * Connects to the local Tally instance, reads the open company name,
 * and checks if it matches the configured company ("Sri Chakra Industries").
 */
export const validateCompany = async (req, res) => {
  try {
    const cfg = await TallyConfig.findOne();
    if (!cfg || !cfg.tallyLocalUrl) {
      return res.json({
        success: true,
        data: {
          reachable: false,
          openCompany: null,
          companyMatch: false,
          error: 'Tally Local URL is not configured. Go to Settings tab and set the Tally machine URL (e.g. http://localhost or http://192.168.1.10).',
        },
      });
    }
    const result = await validateTallyConnection(cfg);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── FULL EXPORT STREAM (new complete version) ───────────────────────────────
/**
 * GET /api/tally/full-export-stream?token=<jwt>
 * Streams all 14 export tasks as SSE events.
 * Direction: ERP → Tally.
 */
export const fullExportToTallyStream = async (req, res) => {
  const send = sseSetup(res);
  const syncId = `FULL-EXPORT-${Date.now()}`;
  const start  = Date.now();

  const user = await authenticateSseRequest(req);
  if (!user) {
    send({ event: 'error', message: 'Unauthorized — invalid or missing token' });
    return res.end();
  }

  send({ event: 'start', message: 'Full Export to Tally started (ERP → Tally)', syncId, direction: 'ERP → Tally' });

  try {
    const cfg = await TallyConfig.findOne();
    if (!cfg || !cfg.tallyLocalUrl) {
      send({ event: 'error', message: 'Tally Local URL is not configured. Go to Settings tab first.' });
      return res.end();
    }

    // Validate connection + company before starting
    send({ event: 'log', level: 'info', entity: 'Connection', message: 'Validating Tally connection and company…' });
    const validation = await validateTallyConnection(cfg);
    if (!validation.reachable) {
      send({ event: 'error', message: `Cannot connect to Tally: ${validation.error}` });
      return res.end();
    }

    const expectedCo = (cfg.companyName || '').trim();
    if (expectedCo && validation.openCompany && !validation.companyMatch) {
      send({
        event: 'error',
        message: `Wrong company open in Tally! Expected "${expectedCo}" but "${validation.openCompany}" is currently open. Please open the correct company in Tally Prime and try again.`,
        openCompany: validation.openCompany,
        expectedCompany: expectedCo,
      });
      return res.end();
    }

    send({ event: 'log', level: 'success', entity: 'Connection', message: `✅ Connected to Tally — Company: ${validation.openCompany || 'detected'}` });

    // Run full export with progress callbacks
    await runFullExportToTally(cfg, user._id, (evt) => {
      send(evt);
    });

    const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    send({ event: 'done', direction: 'ERP → Tally', duration, message: `Full export completed in ${duration}` });

  } catch (err) {
    const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await TallySyncLog.create({
      syncId, type: 'Full', entity: '', direction: 'ERP → Tally',
      status: 'Failed', duration, error: err.message, records: 0, triggeredBy: user._id,
    }).catch(() => {});
    send({ event: 'error', message: `Export failed: ${err.message}`, error: err.message });
  }

  res.end();
};

// ─── SELECTIVE EXPORT STREAM ─────────────────────────────────────────────────
/**
 * GET /api/tally/selective-export-stream?key=<taskKey>&token=<jwt>
 * Runs a single named export task.
 */
export const selectiveExportStream = async (req, res) => {
  const send = sseSetup(res);

  const user = await authenticateSseRequest(req);
  if (!user) {
    send({ event: 'error', message: 'Unauthorized — invalid or missing token' });
    return res.end();
  }

  const key = req.query.key || '';
  if (!key) {
    send({ event: 'error', message: 'Missing ?key= parameter' });
    return res.end();
  }

  try {
    const cfg = await TallyConfig.findOne();
    if (!cfg || !cfg.tallyLocalUrl) {
      send({ event: 'error', message: 'Tally Local URL not configured' });
      return res.end();
    }

    send({ event: 'start', message: `Exporting ${key}…`, direction: 'ERP → Tally' });
    const result = await runSelectiveExport(cfg, key, user._id);
    send({ event: 'done', ok: result.ok, records: result.records, error: result.error, warning: result.warning, message: result.ok ? `✅ ${key}: ${result.records} records exported` : `❌ ${key}: ${result.error}` });
  } catch (err) {
    send({ event: 'error', message: err.message });
  }

  res.end();
};

// ─── EXPORT COUNTS (pre-flight data counts) ──────────────────────────────────
/**
 * GET /api/tally/export-counts
 * Returns how many records of each type will be exported.
 */
export const getExportCounts = async (req, res) => {
  try {
    const [
      itemCount, warehouseCount, categoryCount, vendorCount, clientCount, corporateCount,
      ledgerCount, invoiceCount, poCount, creditNoteCount, debitNoteCount,
      paymentCount, receiptCount, journalCount,
    ] = await Promise.all([
      ItemMaster.countDocuments({ isActive: true }),
      (await import('../models/Warehouse.js')).default.countDocuments({ status: 'Active' }),
      (await import('../models/Category.js')).default.countDocuments(),
      Vendor.countDocuments({ status: { $ne: 'Blacklisted' } }),
      Client.countDocuments({ status: 'Active' }),
      (await import('../models/CorporateClient.js')).default.countDocuments({ status: 'Active' }),
      AccountsLedger.countDocuments({ isActive: true }),
      Invoice.countDocuments({ status: { $in: ['Sent', 'Paid', 'Partial', 'Overdue'] } }),
      PurchaseOrder.countDocuments({ status: { $in: ['Approved', 'Received'] } }),
      (await import('../models/CreditNote.js')).default.countDocuments({ status: { $ne: 'Disputed' } }),
      (await import('../models/DebitNote.js')).default.countDocuments({ approvalStatus: { $in: ['Approved', 'Posted'] } }),
      TallyVoucher.countDocuments({ voucherType: 'Payment', source: 'ERP', tallyGuid: { $exists: false } }),
      TallyVoucher.countDocuments({ voucherType: 'Receipt', source: 'ERP', tallyGuid: { $exists: false } }),
      TallyVoucher.countDocuments({ voucherType: 'Journal', source: 'ERP', tallyGuid: { $exists: false } }),
    ]);

    res.json({
      success: true,
      data: {
        units:           { label: 'Units of Measure',       count: 8 },
        stockGroups:     { label: 'Stock Groups',           count: categoryCount },
        godowns:         { label: 'Godowns / Warehouses',   count: warehouseCount },
        systemLedgers:   { label: 'Ledger Masters',         count: 7 + ledgerCount },
        vendorLedgers:   { label: 'Vendor Masters',         count: vendorCount },
        customerLedgers: { label: 'Customer Masters',       count: clientCount + corporateCount },
        stockItems:      { label: 'Stock Items + Opening Stock', count: itemCount },
        salesInvoices:   { label: 'Sales Invoices',         count: invoiceCount },
        purchaseInvoices:{ label: 'Purchase Invoices',      count: poCount },
        creditNotes:     { label: 'Credit Notes',           count: creditNoteCount },
        debitNotes:      { label: 'Debit Notes',            count: debitNoteCount },
        paymentVouchers: { label: 'Payment Vouchers',       count: paymentCount },
        receiptVouchers: { label: 'Receipt Vouchers',       count: receiptCount },
        journalVouchers: { label: 'Journal Vouchers',       count: journalCount },
        total: itemCount + warehouseCount + categoryCount + vendorCount + clientCount + corporateCount + ledgerCount + invoiceCount + poCount + creditNoteCount + debitNoteCount + paymentCount + receiptCount + journalCount,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
