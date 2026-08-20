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
import { pullEntityFromTally, clearVoucherCache } from '../services/tallyFetchEngine.js';
import {
  validateTallyConnection,
  getExportConfig,
  runFullExportToTally,
  runSelectiveExport,
} from '../services/tallyExportService.js';
import { importFromFiles } from '../services/tallyFileImporter.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { exportPOInvoicesToTally, getPOInvoiceExportCount } from '../services/poTallyExportService.js';

// ── SSE helper ────────────────────────────────────────────────────────────────
function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Send periodic heartbeat (keepalive) to prevent connection from timing out
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(': heartbeat\n\n'); // Comment line as heartbeat, keeps SSE open
    } catch (err) {
      clearInterval(heartbeatInterval);
    }
  }, 15000); // Every 15 seconds

  // Clear interval when client closes connection
  res.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return (payload) => {
    try { 
      res.write(`data: ${JSON.stringify(payload)}\n\n`); 
    } catch (_) {}
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
    let config = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    if (!config) config = await TallyConfig.create({});
    res.json({ success: true, data: config });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

export const saveConfig = async (req, res) => {
  try {
    let config = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
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
      TallyConfig.findOne({}, null, { sort: { _id: 1 } }),
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
// Returns ALL imported entities — masters + every voucher type — dynamically.
// A module only appears if it has been imported (count > 0) or has a sync log.
export const getMasterDataStatus = async (req, res) => {
  try {
    // ── 1. Master collection counts ─────────────────────────────────────────
    const [itemTotal, itemSynced, vendorTotal, vendorSynced,
           clientTotal, clientSynced, ledgerTotal, ledgerSynced] = await Promise.all([
      ItemMaster.countDocuments({ isActive: true }),
      ItemMaster.countDocuments({ tallyGuid: { $exists: true, $ne: null } }),
      Vendor.countDocuments(),
      Vendor.countDocuments({ tallyGuid: { $exists: true, $ne: null } }),
      Client.countDocuments(),
      Client.countDocuments({ tallyGuid: { $exists: true, $ne: null } }),
      AccountsLedger.countDocuments(),
      AccountsLedger.countDocuments({ tallyGuid: { $exists: true, $ne: null } }),
    ]);

    // ── 2. Voucher counts per type from TallyVoucher ─────────────────────────
    const voucherTypes = ['Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra', 'Debit Note', 'Credit Note'];
    const voucherCounts = await TallyVoucher.aggregate([
      { $group: { _id: '$voucherType', total: { $sum: 1 }, lastDate: { $max: '$syncedAt' } } },
    ]);
    const vMap = {};
    for (const v of voucherCounts) if (v._id) vMap[v._id] = { total: v.total, lastDate: v.lastDate };

    // ── 3. Last sync log per entity key ──────────────────────────────────────
    const logKeys = ['Item Master', 'Ledger', 'Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra', 'Debit Note', 'Credit Note'];
    const lastLogs = await Promise.all(logKeys.map(k =>
      TallySyncLog.findOne({ type: k }).sort({ createdAt: -1 }).lean()
    ));
    const logMap = {};
    logKeys.forEach((k, i) => { logMap[k] = lastLogs[i]; });

    const fmtDate = d => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never';
    const rowStatus = (total, synced, failed) =>
      failed > 0 ? 'Partial' : synced > 0 ? 'Synced' : total > 0 ? 'Pending' : 'Not Imported';

    // ── 4. Build master rows (always show if any record exists) ──────────────
    const masterRows = [
      { key: 'Items',   logKey: 'Item Master', icon: '📦', total: itemTotal,   synced: itemSynced,   lastDate: logMap['Item Master']?.createdAt },
      { key: 'Ledgers', logKey: 'Ledger',      icon: '📒', total: ledgerTotal,  synced: ledgerSynced, lastDate: logMap['Ledger']?.createdAt },
      { key: 'Vendors', logKey: 'Ledger',      icon: '🏭', total: vendorTotal,  synced: vendorSynced, lastDate: logMap['Ledger']?.createdAt },
      { key: 'Clients', logKey: 'Ledger',      icon: '👥', total: clientTotal,  synced: clientSynced, lastDate: logMap['Ledger']?.createdAt },
    ].filter(r => r.total > 0 || r.synced > 0).map(r => {
      const log = logMap[r.logKey];
      const failed = log?.status === 'Failed' ? 1 : 0;
      return {
        category: r.key,
        icon: r.icon,
        moduleType: 'master',
        total: r.total,
        synced: r.synced,
        pending: Math.max(0, r.total - r.synced),
        failed,
        lastSync: fmtDate(r.lastDate),
        status: rowStatus(r.total, r.synced, failed),
      };
    });

    // ── 5. Build voucher rows (only show types that have been imported) ───────
    const voucherIconMap = {
      Purchase: '🛒', Sales: '💰', Payment: '💸',
      Receipt: '🧾', Journal: '📋', Contra: '🔄',
      'Debit Note': '📉', 'Credit Note': '📈',
    };
    const voucherRows = voucherTypes
      .filter(vt => vMap[vt]?.total > 0)
      .map(vt => {
        const log = logMap[vt];
        const failed = log?.status === 'Failed' ? 1 : 0;
        const total = vMap[vt]?.total || 0;
        return {
          category: `${vt} Vouchers`,
          icon: voucherIconMap[vt] || '📄',
          moduleType: 'voucher',
          voucherType: vt,
          total,
          synced: total,
          pending: 0,
          failed,
          lastSync: fmtDate(vMap[vt]?.lastDate || log?.createdAt),
          status: rowStatus(total, total, failed),
        };
      });

    const result = [...masterRows, ...voucherRows];
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Transaction Status ────────────────────────────────────────────────────────
export const getTransactionStatus = async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const types = ['Purchase Vouchers', 'Sales Vouchers', 'Payment Vouchers', 'Receipt Vouchers', 'Journal Vouchers', 'Contra Vouchers'];
    const typeMap = {
      'Purchase Vouchers': 'Purchase', 'Sales Vouchers': 'Sales',
      'Payment Vouchers': 'Payment', 'Receipt Vouchers': 'Receipt', 'Journal Vouchers': 'Journal', 'Contra Vouchers': 'Contra',
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
    const { type, partyName, search, limit = 50, page = 1, dateFrom, dateTo } = req.query;
    const filter = {};
    if (type) filter.voucherType = type;

    // Date range filter
    if (dateFrom || dateTo) {
      filter.voucherDate = {};
      if (dateFrom) filter.voucherDate.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        filter.voucherDate.$lte = end;
      }
    }

    // Support combined search across partyName, voucherNumber, narration
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [{ partyName: re }, { voucherNumber: re }, { narration: re }];
    } else if (partyName) {
      filter.partyName = new RegExp(partyName, 'i');
    }

    const pageNum  = Math.max(1, parseInt(page));
    const pageSize = Math.min(200, Math.max(1, parseInt(limit)));
    const skip     = (pageNum - 1) * pageSize;

    const [vouchers, total] = await Promise.all([
      TallyVoucher.find(filter)
        .sort({ voucherDate: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      TallyVoucher.countDocuments(filter),
    ]);

    res.json({ success: true, data: vouchers, total, page: pageNum, pageSize });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

export const getVoucherById = async (req, res) => {
  try {
    const voucher = await TallyVoucher.findById(req.params.id).lean();
    if (!voucher) return res.status(404).json({ success: false, message: 'Voucher not found' });
    res.json({ success: true, data: voucher });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Reset voucher sync states so next import re-fetches all items/amounts ─────
export const resetVoucherSyncStates = async (req, res) => {
  try {
    const TallySyncState = (await import('../models/TallySyncState.js')).default;
    const VOUCHER_TYPES = ['Vouchers', 'Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra', 'Debit Note', 'Credit Note'];
    const result = await TallySyncState.updateMany(
      { entityType: { $in: VOUCHER_TYPES } },
      { $set: { lastSyncedDate: null, syncStatus: 'idle', lastCompletedChunkIndex: -1, chunks: [] } }
    );
    const [total, zeroAmt] = await Promise.all([
      TallyVoucher.countDocuments({}),
      TallyVoucher.countDocuments({ amount: { $lte: 0 } }),
    ]);
    res.json({
      success: true,
      message: `Sync states reset for ${result.modifiedCount} voucher types. Run a Full Sync to re-fetch all voucher details.`,
      data: { totalVouchers: total, zeroAmountVouchers: zeroAmt, resetCount: result.modifiedCount },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Fix bill-to data on existing records: strip literal TDL tags from addresses
// and populate empty billToName from partyName ─────────────────────────────────
export const fixBillToData = async (req, res) => {
  try {
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');

    // Helper: returns true if the value is NOT a valid 6-digit Indian pincode.
    // Tally stores a sequential internal counter in PARTYPINCODE/BILLTOPINCODE
    // (e.g. 1, 2, 3... or 560094, 560095, 560096 incrementing per voucher).
    // A real pincode has exactly 6 digits and starts with 1-9.
    const isBadPincode = (pin) => {
      const s = String(pin || '').replace(/\D/g, '');
      return !s || !/^[1-9]\d{5}$/.test(s);
    };

    // ── Step 1: Collect vouchers with blank/invalid billToAddress or billToPincode ──
    const vouchers = await TallyVoucher.find({ voucherType: 'Sales' },
      { partyName: 1, billToName: 1, billToAddress: 1, billToPincode: 1,
        billToCity: 1, billToState: 1, billToGST: 1, partyGstin: 1 }).lean();

    const needsFix = vouchers.filter(v =>
      !v.billToAddress || !String(v.billToAddress).trim() ||
      !v.billToPincode || !String(v.billToPincode).trim() ||
      isBadPincode(v.billToPincode)   // also fix sequential counter pincodes
    );

    if (!needsFix.length) {
      return res.json({ success: true, message: 'All vouchers already have Bill To address and pincode.', data: { invoiceFixed: 0, voucherFixed: 0 } });
    }

    // ── Step 2: Fetch ALL ledgers from Tally with full address using FETCH>* ──
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    if (!cfg) return res.status(500).json({ success: false, message: 'Tally not configured.' });

    const co    = (cfg.companyName || '').trim().toUpperCase();
    const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
    const timeout = (cfg.useConnector && cfg.connectorId) ? 180000 : 90000;

    // Use FETCH>* to get every field Tally has on the ledger.
    // This is the only reliable way to get Address, Pincode, City, State
    // across all Tally versions (Prime, ERP 9, EDU).
    const ledgerXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AllLedgersFull</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="AllLedgersFull">
      <TYPE>Ledger</TYPE>
      <FETCH>*</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

    const resp = await postXmlWithRetry(cfg, ledgerXml, timeout, 1);

    // ── Step 3: Parse every ledger block and extract address fields ──────────
    // Tally uses multiple tag names across versions:
    //   Address lines: ADDRESS.LIST > ADDRESS  or  MAILINGADDRESS.LIST > MAILINGADDRESS
    //   City:  LEDGERCITY  or  $LedgerCity
    //   State: LEDGERSTATE or  STATENAME
    //   Pin:   PINCODE     or  LEDGERPINCODE
    //   GST:   GSTIN       or  PARTYGSTIN
    const tallyLedgerMap = new Map();

    const getTag = (block, ...tags) => {
      for (const t of tags) {
        const m = block.match(new RegExp(`<${t}[^>]*>([^<]*)<\\/${t}>`, 'i'));
        if (m && m[1].trim() && !/^\.+$/.test(m[1].trim())) return m[1].trim();
      }
      return '';
    };

    const getAddressLines = (block) => {
      // Try ADDRESS.LIST first (most common in Tally Prime)
      const listMatch = block.match(/<ADDRESS\.LIST[^>]*>([\s\S]*?)<\/ADDRESS\.LIST>/i);
      if (listMatch) {
        const lines = [...listMatch[1].matchAll(/<ADDRESS>([\s\S]*?)<\/ADDRESS>/gi)]
          .map(m => m[1].trim()).filter(l => l && !/^\.+$/.test(l));
        if (lines.length) return lines;
      }
      // Try individual ADDRESS tags
      const direct = [...block.matchAll(/<ADDRESS>([^<]*)<\/ADDRESS>/gi)]
        .map(m => m[1].trim()).filter(l => l && !/^\.+$/.test(l));
      if (direct.length) return direct;
      // Try MAILINGADDRESS
      const mailing = [...block.matchAll(/<MAILINGADDRESS>([^<]*)<\/MAILINGADDRESS>/gi)]
        .map(m => m[1].trim()).filter(l => l && !/^\.+$/.test(l));
      return mailing;
    };

    for (const m of (resp || '').matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
      const block = m[1];
      const name  = getTag(block, 'NAME');
      if (!name) continue;

      const addrLines = getAddressLines(block);
      const address   = addrLines.join(', ');
      const city      = getTag(block, 'LEDGERCITY', 'CITY');
      const state     = getTag(block, 'LEDGERSTATE', 'STATENAME', 'STATE');
      const gstin     = getTag(block, 'GSTIN', 'PARTYGSTIN', 'GSTREGISTRATIONNUMBER');

      // Pincode: explicit tag first, then extract 6 digits from address lines.
      // NOTE: Tally's PINCODE field is an internal sequential counter — only trust it
      // if it looks like a real 6-digit Indian pincode (starts with 1-9).
      let pincode = getTag(block, 'PINCODE', 'LEDGERPINCODE').replace(/\D/g, '').slice(0, 6);
      if (!/^[1-9]\d{5}$/.test(pincode)) pincode = ''; // reject sequential counters
      if (!pincode) {
        const allText = addrLines.join(' ') + ' ' + city;
        const pinMatch = allText.match(/\b([1-9]\d{5})\b/);
        if (pinMatch) pincode = pinMatch[1];
      }

      tallyLedgerMap.set(name.toLowerCase(), { address, city, state, pincode, gstin });
    }

    console.log(`[fixBillToData] Tally returned ${tallyLedgerMap.size} ledgers`);
    // Log a sample to verify address parsing works
    const sample = [...tallyLedgerMap.entries()].find(([, v]) => v.address || v.pincode);
    if (sample) console.log('[fixBillToData] Sample with data:', sample[0], JSON.stringify(sample[1]));

    // ── Step 4: Update TallyVoucher documents ────────────────────────────────
    let voucherFixed = 0;
    const partyNames = [...new Set(needsFix.map(v => (v.billToName || v.partyName || '').trim()).filter(Boolean))];

    for (const partyName of partyNames) {
      const ld = tallyLedgerMap.get(partyName.toLowerCase());
      if (!ld || (!ld.address && !ld.pincode && !ld.city && !ld.state)) continue;

      const updates = {};
      if (ld.address) updates.billToAddress = ld.address;
      if (ld.city)    updates.billToCity    = ld.city;
      if (ld.state)   updates.billToState   = ld.state;
      if (ld.gstin)   updates.billToGST     = ld.gstin;
      // Always overwrite pincode from ledger — existing values may be sequential counters
      if (ld.pincode) updates.billToPincode = ld.pincode;

      if (Object.keys(updates).length > 0) {
        const result = await TallyVoucher.updateMany(
          { $or: [{ billToName: partyName }, { partyName: partyName }], voucherType: 'Sales' },
          { $set: updates }
        );
        voucherFixed += result.modifiedCount || 0;
        console.log(`[fixBillToData] Updated ${result.modifiedCount} vouchers for "${partyName}" → addr="${ld.address}" pin="${ld.pincode}"`);
      }
    }

    res.json({
      success: true,
      message: `Fetched ${tallyLedgerMap.size} ledgers from Tally. Updated ${voucherFixed} voucher(s) with Bill To address/pincode.`,
      data: { invoiceFixed: 0, voucherFixed, tallyLedgersFound: tallyLedgerMap.size, partiesNeedingFix: partyNames.length },
    });
  } catch (e) {
    console.error('[fixBillToData]', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

export const createVoucher = async (req, res) => {
  try {
    const voucher = await TallyVoucher.create({ ...req.body, source: 'ERP' });
    res.json({ success: true, data: voucher, message: 'Voucher created (will sync to Tally on next sync)' });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

export const updateVoucher = async (req, res) => {
  try {
    // Only allow editing of address/party fields — never overwrite financial or Tally-sync fields
    const allowed = [
      'billToName', 'billToMailingName', 'billToAddress', 'billToCity',
      'billToState', 'billToCountry', 'billToGST', 'billToGstRegType',
      'shipToName', 'shipToMailingName', 'shipToAddress', 'shipToCity',
      'shipToState', 'shipToCountry', 'shipToGST',
      'partyName', 'partyGstin',
    ];
    const updates = {};
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No editable fields provided' });
    }
    const voucher = await TallyVoucher.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
    if (!voucher) return res.status(404).json({ success: false, message: 'Voucher not found' });
    res.json({ success: true, data: voucher, message: 'Voucher updated' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

export const deleteVoucher = async (req, res) => {
  try {
    await TallyVoucher.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Voucher deleted' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── GUID STATUS ──────────────────────────────────────────────────────────────

// ─── RESET INVOICE TALLY-SYNC FLAGS ──────────────────────────────────────────
/**
 * POST /api/tally/reset-invoice-sync
 * Clears tallySync=true on all ERP Invoices so they will be re-exported on
 * the next Sales Invoice export run.
 *
 * The export uses ACTION="Alter" for any voucher whose number already exists
 * in Tally, so re-exporting will UPDATE the existing Tally vouchers in-place
 * (adding item lines + correct Ship To) without creating duplicates.
 *
 * Optional body: { invoiceNos: ['INV-001', 'INV-002'] }
 * When invoiceNos is provided, only those specific invoices are reset.
 * When omitted, ALL synced invoices are reset.
 */
export const resetInvoiceSyncFlags = async (req, res) => {
  try {
    const { invoiceNos } = req.body || {};
    let filter = { tallySync: true };
    if (Array.isArray(invoiceNos) && invoiceNos.length > 0) {
      filter = { invoiceNo: { $in: invoiceNos } };
    }
    const result = await Invoice.updateMany(filter, {
      $set: { tallySync: false },
      $unset: { tallySyncAt: '' },
    });
    const count = result.modifiedCount || 0;
    res.json({
      success: true,
      message: `Reset ${count} invoice(s). Run Sales Invoice export to update them in Tally.`,
      data: { reset: count },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};


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

// ─── DASHBOARD STATS — single endpoint for the unified ERP+Tally dashboard ───
/**
 * GET /api/tally/dashboard-stats
 * Returns a consolidated snapshot combining:
 *  - Tally voucher counts + totals (Sales, Purchase, Payment, Receipt, Debit/Credit Note)
 *  - Tally master data counts (Ledgers, Vendors, Clients, Items)
 *  - ERP record counts (Invoices, POs, SalesOrders, WorkOrders)
 *  - Sync health (connection status, last sync time, today's sync stats)
 *  - Finance totals (AP, AR)
 */
export const getTallyDashboardStats = async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // ── Tally voucher aggregation ──────────────────────────────────────────
    const [voucherAgg, voucherFinAgg] = await Promise.all([
      // Count per type
      TallyVoucher.aggregate([
        { $group: { _id: '$voucherType', count: { $sum: 1 }, total: { $sum: '$amount' }, lastDate: { $max: '$voucherDate' } } },
      ]),
      // Recent 5 vouchers for activity feed (any type)
      TallyVoucher.find({}).sort({ voucherDate: -1 }).limit(5).lean(),
    ]);

    const vMap = {};
    for (const v of voucherAgg) if (v._id) vMap[v._id] = { count: v.count, total: Math.abs(v.total || 0), lastDate: v.lastDate };

    const tallyVouchers = {
      sales:      { count: vMap['Sales']?.count || 0,       total: vMap['Sales']?.total || 0,       last: vMap['Sales']?.lastDate },
      purchase:   { count: vMap['Purchase']?.count || 0,    total: vMap['Purchase']?.total || 0,    last: vMap['Purchase']?.lastDate },
      payment:    { count: vMap['Payment']?.count || 0,     total: vMap['Payment']?.total || 0,     last: vMap['Payment']?.lastDate },
      receipt:    { count: vMap['Receipt']?.count || 0,     total: vMap['Receipt']?.total || 0,     last: vMap['Receipt']?.lastDate },
      journal:    { count: vMap['Journal']?.count || 0,     total: vMap['Journal']?.total || 0,     last: vMap['Journal']?.lastDate },
      contra:     { count: vMap['Contra']?.count || 0,      total: vMap['Contra']?.total || 0,      last: vMap['Contra']?.lastDate },
      debitNote:  { count: vMap['Debit Note']?.count || 0,  total: vMap['Debit Note']?.total || 0,  last: vMap['Debit Note']?.lastDate },
      creditNote: { count: vMap['Credit Note']?.count || 0, total: vMap['Credit Note']?.total || 0, last: vMap['Credit Note']?.lastDate },
      totalCount: Object.values(vMap).reduce((s, v) => s + v.count, 0),
      recent: voucherFinAgg.map(v => ({
        id: v._id,
        type: v.voucherType,
        party: v.partyName || '—',
        amount: v.amount || 0,
        date: v.voucherDate,
        number: v.voucherNumber || '—',
      })),
    };

    // ── Tally master data counts ───────────────────────────────────────────
    const [
      ledgerTotal, ledgerSynced,
      vendorTotal, vendorSynced,
      clientTotal, clientSynced,
      itemTotal,   itemSynced,
    ] = await Promise.all([
      AccountsLedger.countDocuments({}),
      AccountsLedger.countDocuments({ tallyGuid: { $exists: true, $ne: null } }),
      Vendor.countDocuments({}),
      Vendor.countDocuments({ tallyGuid: { $exists: true, $ne: null } }),
      Client.countDocuments({}),
      Client.countDocuments({ tallyGuid: { $exists: true, $ne: null } }),
      ItemMaster.countDocuments({ isActive: true }),
      ItemMaster.countDocuments({ tallyGuid: { $exists: true, $ne: null } }),
    ]);

    const tallyMasters = {
      ledgers:  { total: ledgerTotal, synced: ledgerSynced },
      vendors:  { total: vendorTotal, synced: vendorSynced },
      clients:  { total: clientTotal, synced: clientSynced },
      items:    { total: itemTotal,   synced: itemSynced },
    };

    // ── ERP record counts ──────────────────────────────────────────────────
    const WorkOrder = (await import('../models/WorkOrder.js')).default;
    const SalesOrder = (await import('../models/SalesOrder.js')).default;
    const InventoryItem = (await import('../models/InventoryItem.js')).default;

    const [
      invoiceTotal, invoicePaid, invoiceOverdue, invoiceSynced,
      poTotal, poApproved, poSynced,
      salesOrderTotal, salesOrderPending,
      woTotal, woInProgress, woCompleted,
      invItemTotal, invItemCritical,
    ] = await Promise.all([
      Invoice.countDocuments({}),
      Invoice.countDocuments({ paymentStatus: 'Paid' }),
      Invoice.countDocuments({ paymentStatus: 'Overdue' }),
      Invoice.countDocuments({ tallySync: true }),
      PurchaseOrder.countDocuments({}),
      PurchaseOrder.countDocuments({ status: 'Approved' }),
      PurchaseOrder.countDocuments({ tallyGuid: { $exists: true, $ne: null } }),
      SalesOrder.countDocuments({}),
      SalesOrder.countDocuments({ status: 'Pending Approval' }),
      WorkOrder.countDocuments({}),
      WorkOrder.countDocuments({ status: { $in: ['Released', 'In-Progress'] } }),
      WorkOrder.countDocuments({ status: 'Completed' }),
      InventoryItem.countDocuments({}),
      InventoryItem.countDocuments({ status: 'Critical' }),
    ]);

    const erpStats = {
      invoices:    { total: invoiceTotal, paid: invoicePaid, overdue: invoiceOverdue, syncedToTally: invoiceSynced },
      purchaseOrders: { total: poTotal, approved: poApproved, syncedToTally: poSynced },
      salesOrders: { total: salesOrderTotal, pendingApproval: salesOrderPending },
      workOrders:  { total: woTotal, inProgress: woInProgress, completed: woCompleted },
      inventory:   { total: invItemTotal, critical: invItemCritical },
    };

    // ── Finance totals (AP/AR) ─────────────────────────────────────────────
    const AccountsPayable     = (await import('../models/AccountsPayable.js')).default;
    const AccountsReceivable  = (await import('../models/AccountsReceivable.js')).default;
    const [apAgg, arAgg] = await Promise.all([
      AccountsPayable.aggregate([{ $group: { _id: null, total: { $sum: '$balanceAmount' }, count: { $sum: 1 } } }]),
      AccountsReceivable.aggregate([{ $group: { _id: null, total: { $sum: '$balanceAmount' }, count: { $sum: 1 } } }]),
    ]);
    const financeStats = {
      accountsPayable:    { total: apAgg[0]?.total || 0, count: apAgg[0]?.count || 0 },
      accountsReceivable: { total: arAgg[0]?.total || 0, count: arAgg[0]?.count || 0 },
    };

    // ── Tally sync health ──────────────────────────────────────────────────
    const [config, todayLogs, todaySuccess, todayFailed, recentSyncLogs] = await Promise.all([
      TallyConfig.findOne({}, null, { sort: { _id: 1 } }),
      TallySyncLog.countDocuments({ createdAt: { $gte: today } }),
      TallySyncLog.countDocuments({ createdAt: { $gte: today }, status: 'Success' }),
      TallySyncLog.countDocuments({ createdAt: { $gte: today }, status: 'Failed' }),
      TallySyncLog.find({}).sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    const syncHealth = {
      connectionStatus: config?.connectionStatus || 'Unknown',
      lastSyncAt: config?.lastSyncAt || null,
      companyName: config?.companyName || '',
      syncDirection: config?.syncDirection || 'Bi-directional',
      autoSync: config?.autoSync || false,
      syncInterval: config?.syncInterval || 'Every 15 minutes',
      todayTotal: todayLogs,
      todaySuccess,
      todayFailed,
      successRate: todayLogs > 0 ? ((todaySuccess / todayLogs) * 100).toFixed(1) : '0.0',
      recentLogs: recentSyncLogs.map(l => ({
        id: l._id, type: l.type, status: l.status, records: l.records, createdAt: l.createdAt,
      })),
    };

    res.json({
      success: true,
      data: { tallyVouchers, tallyMasters, erpStats, financeStats, syncHealth },
    });
  } catch (e) {
    console.error('[TallyDashboardStats] error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
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
    const modules = [];
    const detailedLogs = [];

    const log = (level, entity, msg, extra = {}) => {
      const entry = { ts: new Date().toISOString(), level, entity, msg, ...extra };
      detailedLogs.push(entry);
      send({ event: 'log', level, entity, message: msg, ...extra });
    };

    try {
      const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
      // In connector mode, tallyLocalUrl is not required — the connector handles routing.
      // In direct mode, tallyLocalUrl must be set.
      const hasConnection = cfg?.useConnector && cfg?.connectorId
        ? true
        : !!(cfg?.tallyLocalUrl);
      if (!cfg || !hasConnection) {
        send({ event: 'error', message: cfg?.useConnector
          ? `Connector is enabled but connectorId is missing. Re-register the SriChakra Connector.`
          : 'Tally Local URL is not configured. Go to Configuration tab and set the Tally machine URL, or enable Connector mode.' });
        return res.end();
      }

      // Determine which entities to import
      const entityMap = {
        Full:     ['Items', 'Ledgers', 'Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra', 'Debit Note', 'Credit Note'],
        master:   ['Items', 'Ledgers'],
        transaction: ['Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra', 'Debit Note', 'Credit Note'],
        Items:    ['Items'],
        Ledgers:  ['Ledgers'],
        Purchase: ['Purchase'],
        Sales:    ['Sales'],
        Payment:  ['Payment'],
        Receipt:  ['Receipt'],
        Journal:  ['Journal'],
        Contra:   ['Contra'],
        'Debit Note':  ['Debit Note'],
        'Credit Note': ['Credit Note'],
        'Item Master': ['Items'],
        'Ledger':      ['Ledgers'],
      };

      const entities = entityMap[type] || entityMap['Full'];
      const total    = entities.length;

      // Clear the voucher XML cache at the start of every import run so we always
      // fetch fresh data from Tally (the cache is only reused within a single run).
      clearVoucherCache();

      // Auto-reset sync state for all voucher entity types so incremental sync
      // never skips re-fetching existing records with stale/zero amounts.
      try {
        const TallySyncState = (await import('../models/TallySyncState.js')).default;
        const VOUCHER_TYPES = ['Vouchers', 'Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra', 'Debit Note', 'Credit Note'];
        const resetTypes = entities.some(e => VOUCHER_TYPES.includes(e)) ? VOUCHER_TYPES : entities;
        await TallySyncState.updateMany(
          { entityType: { $in: resetTypes } },
          { $set: { lastSyncedDate: null, syncStatus: 'idle', lastCompletedChunkIndex: -1, chunks: [] } }
        );
        console.log(`[Import] Auto-reset sync state for: ${resetTypes.join(', ')}`);
      } catch (e) {
        console.warn(`[Import] sync state reset warning (non-fatal): ${e.message}`);
      }

      send({ event: 'phase', message: `Importing ${entities.join(', ')} from Tally`, total });

      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        send({ event: 'phase_start', entity, index: i + 1, total, message: `Importing ${entity}...` });
        log('info', entity, `Starting import of ${entity} from Tally`);

        const moduleInfo = ENTITY_MODULE_MAP[entity];
        const moduleTimestamp = new Date();

        try {
          const result = await pullEntityFromTally(entity, {
            triggeredBy: user._id,
            forceChunk: false,
            forceRefresh: true,   // always re-fetch full history so amounts/items are never stale
          });

          const entityRecords = result.records || 0;
          stats.total += entityRecords;
          stats.created += result.created || 0;
          stats.updated += result.updated || 0;
          stats.skipped += result.skipped || 0;
          stats.failed += result.failed || 0;

          // Add to modules array
          if (moduleInfo) {
            modules.push({
              name: moduleInfo.name,
              count: entityRecords,
              timestamp: moduleTimestamp,
              route: moduleInfo.route,
              created: result.created || 0,
              updated: result.updated || 0,
              skipped: result.skipped || 0,
              failed: result.failed || 0,
              totalFound: result.totalFound || 0
            });
          }

          if (result.ok) {
            log('success', entity, `✅ ${entity}: ${entityRecords} records imported`, { 
              records: entityRecords, 
              created: result.created, 
              updated: result.updated, 
              skipped: result.skipped, 
              failed: result.failed 
            });
            send({ 
              event: 'phase_done', 
              entity, 
              records: entityRecords, 
              created: result.created, 
              updated: result.updated, 
              skipped: result.skipped, 
              failed: result.failed,
              ok: true,
              message: `${entity} imported — ${entityRecords} records processed` 
            });
          } else {
            log('error', entity, `❌ ${entity} import failed: ${result.error}`, { error: result.error });
            send({ 
              event: 'phase_done', 
              entity, 
              records: 0, 
              ok: false, 
              error: result.error,
              message: `${entity} import failed: ${result.error}` 
            });
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

      // Write a summary sync log with module details
      await TallySyncLog.create({
        syncId, type: type === 'Full' ? 'Full' : type,
        entity: '', direction: 'Tally → ERP',
        status, duration,
        error: stats.failed > 0 ? `${stats.failed} entity type(s) failed` : '',
        records: stats.total,
        modules,
        triggeredBy: user._id,
      }).catch(() => {});

    await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date(), lastImportAt: new Date() }, { sort: { _id: 1 }, upsert: true });

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

// Dynamic mapping between Tally entities and frontend routes/modules
const ENTITY_MODULE_MAP = {
  'Items': {
    name: 'Item Master',
    route: '/item-master',
    logType: 'Item Master'
  },
  'Ledgers': {
    name: 'Ledgers',
    route: '/finance/tally-ledger',
    logType: 'Ledger'
  },
  'Purchase': {
    name: 'Purchase Vouchers',
    route: '/finance/tally-ledger',
    logType: 'Purchase'
  },
  'Sales': {
    name: 'Sales Vouchers',
    route: '/finance/tally-ledger',
    logType: 'Sales'
  },
  'Payment': {
    name: 'Payment Vouchers',
    route: '/finance/tally-ledger',
    logType: 'Payment'
  },
  'Receipt': {
    name: 'Receipt Vouchers',
    route: '/finance/tally-ledger',
    logType: 'Receipt'
  },
  'Journal': {
    name: 'Journal Vouchers',
    route: '/finance/tally-ledger',
    logType: 'Journal'
  },
  'Contra': {
    name: 'Contra Vouchers',
    route: '/finance/tally-ledger',
    logType: 'Contra'
  },
  'Debit Note': {
    name: 'Debit Note Vouchers',
    route: '/finance/tally-ledger',
    logType: 'Debit Note'
  },
  'Credit Note': {
    name: 'Credit Note Vouchers',
    route: '/finance/tally-ledger',
    logType: 'Credit Note'
  }
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
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const hasConnection = cfg?.useConnector && cfg?.connectorId ? true : !!(cfg?.tallyLocalUrl);
    if (!cfg || !hasConnection) {
      send({ event: 'error', message: cfg?.useConnector
        ? `Connector is enabled but connectorId is missing. Re-register the SriChakra Connector.`
        : 'Tally Local URL is not configured. Go to Configuration tab first.' });
      return res.end();
    }

    // ── Auto-detect the open Tally company and correct companyName if needed ──
    // A blank or wrong SVCURRENTCOMPANY tag is the #1 cause of silent EXCEPTIONS.
    // Re-fetch it here so all tasks below use the correct company name.
    try {
      const validation = await validateTallyConnection(cfg);
      if (validation.openCompany) {
        const saved = (cfg.companyName || '').trim();
        if (!saved || saved.toUpperCase() !== validation.openCompany.toUpperCase()) {
          console.log(`[exportToTallyStream] Correcting companyName "${saved}" → "${validation.openCompany}"`);
          cfg.companyName = validation.openCompany;
          await TallyConfig.findOneAndUpdate(
            {},
            { companyName: validation.openCompany },
            { sort: { _id: 1 } }
          ).catch(() => {});
        }
        send({ event: 'log', level: 'info', entity: 'Connection', message: `Using Tally company: "${validation.openCompany}"` });
      }
    } catch (connErr) {
      // Non-fatal — continue with whatever companyName is in cfg
      send({ event: 'log', level: 'warn', entity: 'Connection', message: `Company auto-detect failed (continuing): ${connErr.message}` });
    }

    // Define what to export based on type
    const exportTasks = [];
    const typeNorm = type.toLowerCase();

    const wantsMasters = typeNorm === 'full' || typeNorm === 'masters' || typeNorm === 'purchase' || typeNorm === 'purchase vouchers' || typeNorm === 'sales' || typeNorm === 'sales vouchers' || typeNorm === 'payment' || typeNorm === 'payment vouchers' || typeNorm === 'receipt' || typeNorm === 'receipt vouchers' || typeNorm === 'po-generation' || typeNorm === 'pdf-invoices';
    const wantsPurchase = typeNorm === 'purchase' || typeNorm === 'purchase vouchers';
    const wantsSales = typeNorm === 'full' || typeNorm === 'sales' || typeNorm === 'sales vouchers' || typeNorm === 'po-generation' || typeNorm === 'pdf-invoices';
    const wantsPayment = typeNorm === 'full' || typeNorm === 'payment' || typeNorm === 'payment vouchers';
    const wantsReceipt = typeNorm === 'full' || typeNorm === 'receipt' || typeNorm === 'receipt vouchers';

    // Masters must always be pushed first so party ledgers and stock items exist in Tally
    // before any voucher references them. ACTION="Create" means Tally skips existing ones.
    if (wantsMasters) {
      exportTasks.push({ label: 'Masters (Ledgers & Items)', fn: () => pushMastersToTally(cfg, user._id) });
    }
    if (wantsPurchase) {
      exportTasks.push({ label: 'Purchase Vouchers', fn: () => pushPurchaseVouchersToTally(cfg, user._id) });
    }
    if (wantsSales) {
      exportTasks.push({ label: 'Sales Vouchers', fn: () => pushSalesVouchersToTally(cfg, user._id) });
    }
    if (wantsPayment) {
      exportTasks.push({ label: 'Payment Vouchers', fn: () => pushPaymentVouchersToTally(cfg, user._id) });
    }
    if (wantsReceipt) {
      exportTasks.push({ label: 'Receipt Vouchers', fn: () => pushReceiptVouchersToTally(cfg, user._id) });
    }

    if (exportTasks.length === 0) {
      send({ event: 'error', message: `Unknown export type: "${type}". Valid types: Full, masters, purchase, sales, payment, receipt, po-generation, pdf-invoices` });
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

    await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date(), lastExportAt: new Date() }, { sort: { _id: 1 }, upsert: true });

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
      Full: ['Items', 'Ledgers', 'Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra', 'Debit Note', 'Credit Note'],
      master: ['Items', 'Ledgers'],
      transaction: ['Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra', 'Debit Note', 'Credit Note'],
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
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    if (!cfg) return res.status(400).json({ success: false, message: 'Tally not configured' });

    const results = [];
    const typeNorm = type.toLowerCase();

    if (typeNorm === 'purchase' || typeNorm === 'purchase vouchers' || typeNorm === 'purchaseinvoices' || typeNorm === 'purchaseinvoices')
      results.push(await pushPurchaseVouchersToTally(cfg, req.user?._id));
    if (typeNorm === 'full' || typeNorm === 'sales' || typeNorm === 'sales vouchers' || typeNorm === 'salesinvoices' || typeNorm === 'salesinvoice' || typeNorm === 'po-generation' || typeNorm === 'pdf-invoices')
      results.push(await pushSalesVouchersToTally(cfg, req.user?._id));
    if (typeNorm === 'full' || typeNorm === 'payment' || typeNorm === 'payment vouchers')
      results.push(await pushPaymentVouchersToTally(cfg, req.user?._id));
    if (typeNorm === 'full' || typeNorm === 'receipt' || typeNorm === 'receipt vouchers')
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
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const hasConnection = cfg?.useConnector && cfg?.connectorId ? true : !!(cfg?.tallyLocalUrl);
    if (!cfg || !hasConnection) {
      return res.json({
        success: true,
        data: {
          reachable: false,
          openCompany: null,
          companyMatch: false,
          error: cfg?.useConnector
            ? `Connector is enabled but connectorId is missing. Re-register the SriChakra Connector.`
            : 'Tally Local URL is not configured. Go to Settings tab and set the Tally machine URL (e.g. http://localhost or http://192.168.1.10).',
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
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const hasConnection = cfg?.useConnector && cfg?.connectorId ? true : !!(cfg?.tallyLocalUrl);
    if (!cfg || !hasConnection) {
      send({ event: 'error', message: cfg?.useConnector
        ? `Connector is enabled but connectorId is missing. Re-register the SriChakra Connector.`
        : 'Tally Local URL is not configured. Go to Settings tab first.' });
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

    // ── Auto-save detected company name to cfg and DB ──────────────────────
    // If companyName was empty or mismatched, correct it now so every export
    // task uses the right SVCURRENTCOMPANY tag. Silent EXCEPTIONS in Tally are
    // almost always caused by this tag being wrong or missing.
    if (validation.openCompany) {
      if (!expectedCo || !validation.companyMatch) {
        LOG(`fullExportToTallyStream: ⚠️ updating companyName "${expectedCo}" → "${validation.openCompany}"`);
        cfg.companyName = validation.openCompany;
        await TallyConfig.findOneAndUpdate(
          {},
          { companyName: validation.openCompany },
          { sort: { _id: 1 } }
        ).catch(() => {});
      }
    }

    send({ event: 'log', level: 'success', entity: 'Connection', message: `✅ Connected to Tally — Company: ${validation.openCompany || cfg.companyName || 'detected'}` });

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

  let key = (req.query.key || '').toString().trim();
  if (!key) {
    send({ event: 'error', message: 'Missing ?key= parameter' });
    return res.end();
  }
  key = key.replace(/;$/, '');

  try {
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const hasConnection = cfg?.useConnector && cfg?.connectorId ? true : !!(cfg?.tallyLocalUrl);
    if (!cfg || !hasConnection) {
      send({ event: 'error', message: cfg?.useConnector
        ? `Connector is enabled but connectorId is missing. Re-register the SriChakra Connector.`
        : 'Tally Local URL not configured' });
      return res.end();
    }

    // ── Auto-detect company name before any export task ────────────────────
    try {
      const validation = await validateTallyConnection(cfg);
      if (validation.openCompany) {
        const saved = (cfg.companyName || '').trim();
        if (!saved || saved.toUpperCase() !== validation.openCompany.toUpperCase()) {
          cfg.companyName = validation.openCompany;
          await TallyConfig.findOneAndUpdate({}, { companyName: validation.openCompany }, { sort: { _id: 1 } }).catch(() => {});
        }
      }
    } catch (_) { /* non-fatal */ }

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

// ─── FILE-BASED IMPORT ────────────────────────────────────────────────────────
/**
 * POST /api/tally/import-from-files
 * Triggers import from XML files in C:\TallyExport
 */
export const importFromTallyFiles = async (req, res) => {
  try {
    const result = await importFromFiles();
    res.json({
      success: result.ok,
      data: { records: result.records },
      message: result.ok ? `Successfully imported ${result.records} records from files` : `Import failed: ${result.error}`
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * GET /api/tally/import-from-files-stream?token=<jwt>
 * SSE version of file import
 */
export const importFromTallyFilesStream = async (req, res) => {
  const send = sseSetup(res);
  const syncId = `FILE-IMPORT-STREAM-${Date.now()}`;
  const start = Date.now();

  const user = await authenticateSseRequest(req);
  if (!user) {
    send({ event: 'error', message: 'Unauthorized — invalid or missing token' });
    return res.end();
  }

  send({ event: 'start', message: 'Starting import from Tally XML files…', syncId, direction: 'Tally → ERP' });

  try {
    const result = await importFromFiles();
    const duration = `${((Date.now() - start)/1000).toFixed(1)}s`;

    send({
      event: 'summary',
      direction: 'Tally → ERP',
      message: result.ok ? `File import complete — ${result.records} records processed in ${duration}` : `File import failed — ${result.error}`,
      stats: { ...result, duration },
    });
    send({ event: 'done', ...result, duration });
  } catch (err) {
    send({ event: 'error', message: `Import failed: ${err.message}`, error: err.message });
  }

  res.end();
};

// ─── SALES REGISTER: Import by Date Range (Tally → ERP) ──────────────────────
/**
 * POST /api/tally/import-sales-register
 * Body: { fromDate: "2025-04-01", toDate: "2025-06-30" }
 *
 * Dedicated endpoint to forcibly pull Sales Register vouchers for a specific
 * date range (e.g. April–June FY 2025-26).  Uses forceRefresh + explicit
 * startDate / endDate so it always fetches regardless of lastSyncedDate.
 *
 * Saves vouchers to BOTH Invoice collection (for ERP invoice management)
 * AND TallyVoucher collection (so Finance → Tally Ledger tab shows them).
 */
export const importSalesRegister = async (req, res) => {
  try {
    const { fromDate, toDate } = req.body;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: 'fromDate and toDate are required. Example: { "fromDate": "2025-04-01", "toDate": "2025-06-30" }',
      });
    }

    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const hasConnection = cfg?.useConnector && cfg?.connectorId ? true : !!(cfg?.tallyLocalUrl);
    if (!cfg || !hasConnection) {
      return res.status(400).json({
        success: false,
        message: 'Tally Local URL is not configured. Go to Tally Settings first.',
      });
    }

    console.log(`[SalesRegister] Importing Sales vouchers from ${fromDate} to ${toDate}`);

    const result = await pullEntityFromTally('Sales', {
      triggeredBy: req.user?._id,
      startDate: new Date(fromDate),
      endDate: new Date(toDate),
      forceRefresh: true,    // ignore lastSyncedDate
      forceChunk: true,      // use chunk mode so date range is respected
    });

    const message = result.ok
      ? `Sales Register imported: ${result.records} vouchers (${result.created} new, ${result.updated} updated) for ${fromDate} → ${toDate}`
      : `Sales Register import failed: ${result.error}`;

    res.json({
      success: result.ok,
      data: result,
      message,
      dateRange: { fromDate, toDate },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * GET /api/tally/sales-invoices
 * Query: ?fromDate=2025-04-01&toDate=2025-06-30&partyName=&page=1&limit=50
 *
 * Returns Sales Register invoices (imported from Tally) for a given date range.
 * Searches both Invoice model (source: Tally) and TallyVoucher model (voucherType: Sales).
 */
export const getSalesInvoices = async (req, res) => {
  try {
    const { fromDate, toDate, partyName, search, page = 1, limit = 50 } = req.query;
    const pageNum  = Math.max(1, parseInt(page));
    const pageSize = Math.min(200, Math.max(1, parseInt(limit)));
    const skip     = (pageNum - 1) * pageSize;

    // ── Query TallyVoucher (Sales type) ──────────────────────────────────
    const vFilter = { voucherType: 'Sales' };
    if (fromDate || toDate) {
      vFilter.voucherDate = {};
      if (fromDate) vFilter.voucherDate.$gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        vFilter.voucherDate.$lte = end;
      }
    }
    if (search) {
      const re = new RegExp(search, 'i');
      vFilter.$or = [{ partyName: re }, { voucherNumber: re }, { narration: re }];
    } else if (partyName) {
      vFilter.partyName = new RegExp(partyName, 'i');
    }

    const [vouchers, vTotal] = await Promise.all([
      TallyVoucher.find(vFilter).sort({ voucherDate: -1 }).skip(skip).limit(pageSize).lean(),
      TallyVoucher.countDocuments(vFilter),
    ]);

    // ── Normalise TallyVoucher into Sales Register rows ───────────────────
    const rows = vouchers.map(v => {
      const subtotal   = v.subtotal || v.inventoryEntries?.reduce((s, ie) => s + (ie.amount || 0), 0) || 0;
      const taxTotal   = v.taxTotal || v.taxLines?.reduce((s, t) => s + Math.abs(t.amount), 0) || 0;
      const grandTotal = v.amount   || subtotal + taxTotal;

      const cgst = (v.taxLines || v.ledgerEntries || [])
        .filter(t => t.ledgerName?.toLowerCase().includes('cgst'))
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      const sgst = (v.taxLines || v.ledgerEntries || [])
        .filter(t => t.ledgerName?.toLowerCase().includes('sgst'))
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      const igst = (v.taxLines || v.ledgerEntries || [])
        .filter(t => t.ledgerName?.toLowerCase().includes('igst'))
        .reduce((s, t) => s + Math.abs(t.amount), 0);

      // Helper to calculate tax rate for items
      const calculateItemTaxRate = (item) => {
        if (!item.taxEntries || item.taxEntries.length === 0 || !item.amount || item.amount <= 0) {
          return null;
        }
        const totalItemTax = item.taxEntries.reduce((sum, entry) => sum + entry.amount, 0);
        return (totalItemTax / item.amount) * 100;
      };

      return {
        id:            v._id,
        voucherNumber: v.voucherNumber,
        date:          v.voucherDate,
        partyName:     v.partyName,
        partyGstin:    v.partyGstin || '',
        placeOfSupply: v.placeOfSupply || '',
        narration:     v.narration || '',
        billToName:        v.billToName || '',
        billToMailingName: v.billToMailingName || '',
        billToAddress:     v.billToAddress || '',
        billToCity:        v.billToCity || '',
        billToState:       v.billToState || '',
        billToCountry:     v.billToCountry || '',
        billToPincode:     v.billToPincode || '',
        billToGST:         v.billToGST || '',
        billToGstRegType:  v.billToGstRegType || '',
        shipToName:        v.shipToName || '',
        shipToMailingName: v.shipToMailingName || '',
        shipToAddress:     v.shipToAddress || '',
        shipToCity:        v.shipToCity || '',
        shipToState:       v.shipToState || '',
        shipToCountry:     v.shipToCountry || '',
        shipToPincode:     v.shipToPincode || '',
        shipToGST:         v.shipToGST || '',
        ledgerEntries: v.ledgerEntries || [],
        taxLines:      v.taxLines || [],
        inventoryEntries: (v.inventoryEntries || []).map(ie => ({
          ...ie,
          taxRate: calculateItemTaxRate(ie),
        })),
        subtotal,
        cgst,
        sgst,
        igst,
        taxTotal,
        grandTotal,
        buyersOrderNo: v.buyersOrderNo || '',
        source: 'Tally',
      };
    });

    res.json({
      success: true,
      data: rows,
      total: vTotal,
      page: pageNum,
      pageSize,
      dateRange: { fromDate, toDate },
      // legacy fields kept for backward compat
      vouchers,
      invoices: [],
      voucherTotal: vTotal,
      invoiceTotal: 0,
      totalSalesRecords: vTotal,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── MIGRATE: Re-normalize tallyVoucher GST fields ───────────────────────────
/**
 * POST /api/tally/remigrate-gst-fields
 *
 * Re-normalizes ALL Invoice.tallyVoucher sub-documents so every inventory
 * entry has the correct GSTLEDGERSOURCE / HSNLEDGERSOURCE / GSTHSNNAME values.
 *
 * Steps:
 *   1. Load all ItemMaster records (name → tallySalesLedger + hsn map)
 *   2. Cursor through all exportable invoices
 *   3. Enrich each invoice's items with ItemMaster data
 *   4. Re-run normalizeToTallyVoucher and save updated tallyVoucher
 *   5. Return stats: processed / succeeded / skipped / failed
 *
 * After running this, reset invoice tallySync flags and re-export to Tally.
 */
export const migrateGstFields = async (req, res) => {
  const start = Date.now();
  try {
    const cfg        = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
    const periodEnd  = cfg?.tallyPeriodEnd || null;

    // Load all ItemMaster records once into a name-keyed map
    const allMasters = await ItemMaster.find({}, 'name hsn tallySalesLedger').lean();
    const masterMap  = new Map(allMasters.map(m => [m.name, m]));

    // Helper: stamp each invoice item with tallySalesLedger + hsn from ItemMaster
    function enrichItems(items) {
      return (items || []).map(item => {
        const name = (item.description || item.name || '').trim();
        const im   = masterMap.get(name);
        return {
          ...item,
          hsn:              item.hsn              || im?.hsn              || '',
          tallySalesLedger: item.tallySalesLedger  || im?.tallySalesLedger || '',
        };
      });
    }

    let processed = 0, succeeded = 0, failed = 0, skipped = 0;
    const failures = [];
    const SAMPLE_SIZE = 3;       // collect first N re-normalized entries for the response
    const samples = [];

    const cursor = Invoice.find({ invoiceNo: { $exists: true, $ne: '' } })
      .select('-__v').lean().cursor();

    for await (const inv of cursor) {
      processed++;
      try {
        const grandTotal = +(inv.grandTotal || inv.totalAmount || 0);
        if (!inv.partyName || grandTotal <= 0) { skipped++; continue; }

        const enrichedItems = enrichItems(inv.items);
        const tv = normalizeToTallyVoucher({ ...inv, items: enrichedItems }, { periodEnd });
        await Invoice.updateOne({ _id: inv._id }, { $set: { tallyVoucher: tv } });
        succeeded++;

        // Collect a sample for the response so caller can verify without another DB query
        if (samples.length < SAMPLE_SIZE && tv.allInventoryEntries?.length) {
          const ie0 = tv.allInventoryEntries[0];
          samples.push({
            invoiceNo:      inv.invoiceNo,
            itemName:       ie0.stockItemName,
            gstLedgerSource: ie0.gstLedgerSource || '(empty)',
            hsnLedgerSource: ie0.hsnLedgerSource || '(empty)',
            gstHsnName:      ie0.gstHsnName      || '(empty)',
            acctAlloc0:      ie0.accountingAllocations?.[0]?.ledgerName || '(none)',
          });
        }
      } catch (err) {
        failed++;
        failures.push({ invoiceNo: inv.invoiceNo || String(inv._id), error: err.message });
      }
    }

    const dur = ((Date.now() - start) / 1000).toFixed(1);
    const withLedger = allMasters.filter(m => m.tallySalesLedger).length;

    res.json({
      success: true,
      duration: `${dur}s`,
      stats: { processed, succeeded, skipped, failed },
      itemMasterSummary: {
        total:       allMasters.length,
        withLedger,
        withoutLedger: allMasters.length - withLedger,
        note: withLedger === 0
          ? 'No ItemMaster records have tallySalesLedger set — gstLedgerSource will be "Sales Accounts" for all items. Set ItemMaster.tallySalesLedger via Tally sync or manually, then re-run this endpoint.'
          : `${withLedger} items have item-specific sales ledger names.`,
      },
      samples,
      failures: failures.slice(0, 20),
      message: `Re-normalized ${succeeded} invoices in ${dur}. ` +
               (failed > 0 ? `${failed} failed. ` : '') +
               'Now reset tallySync on invoices and re-export to Tally.',
    });
  } catch (err) {
    console.error('[migrateGstFields]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PO INVOICE EXPORT TO TALLY (SSE stream) ─────────────────────────────────
/**
 * GET /api/tally/po-export-stream?token=<jwt>
 * Streams the PO Invoice export to Tally.
 * Separate from the Sales Export stream — does NOT touch tallyExportService.js.
 */
export const poExportToTallyStream = async (req, res) => {
  const send = sseSetup(res);
  const start = Date.now();

  const user = await authenticateSseRequest(req);
  if (!user) {
    send({ event: 'error', message: 'Unauthorized — invalid or missing token' });
    return res.end();
  }

  send({ event: 'start', message: 'PO Invoice Export to Tally started', direction: 'ERP → Tally' });

  try {
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const hasConnection = cfg?.useConnector && cfg?.connectorId ? true : !!(cfg?.tallyLocalUrl);
    if (!cfg || !hasConnection) {
      send({ event: 'error', message: 'Tally is not configured. Go to Tally Settings first.' });
      return res.end();
    }

    // Validate connection — retry once if connector is offline (handles Render cold-start / ping gap)
    send({ event: 'log', level: 'info', entity: 'Connection', message: 'Validating Tally connection…' });
    let validation = await validateTallyConnection(cfg);
    if (!validation.reachable && cfg.useConnector && cfg.connectorId) {
      send({ event: 'log', level: 'info', entity: 'Connection', message: 'Connector not yet online — waiting 15s and retrying…' });
      await new Promise(r => setTimeout(r, 15000));
      validation = await validateTallyConnection(cfg);
    }
    if (!validation.reachable) {
      send({ event: 'error', message: `Cannot connect to Tally: ${validation.error}` });
      return res.end();
    }

    // Auto-correct company name
    if (validation.openCompany) {
      const saved = (cfg.companyName || '').trim();
      if (!saved || saved.toUpperCase() !== validation.openCompany.toUpperCase()) {
        cfg.companyName = validation.openCompany;
        await TallyConfig.findOneAndUpdate({}, { companyName: validation.openCompany }, { sort: { _id: 1 } }).catch(() => {});
      }
    }

    send({ event: 'log', level: 'success', entity: 'Connection', message: `✅ Connected — Company: ${validation.openCompany || cfg.companyName || 'detected'}` });
    send({ event: 'phase_start', index: 1, total: 1, entity: 'PO Invoices', message: 'Exporting PO Invoices…' });

    const result = await exportPOInvoicesToTally(cfg, user._id);

    const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;

    if (result.ok) {
      send({
        event: 'phase_done', ok: true, entity: 'PO Invoices',
        records: result.records, created: result.created, altered: result.altered,
        message: `✅ PO Invoices: ${result.records} records exported (created: ${result.created}, updated: ${result.altered})`,
      });
    } else {
      send({
        event: 'phase_done', ok: false, entity: 'PO Invoices',
        records: result.records, error: result.error,
        message: `❌ PO Invoices: ${result.error || 'Export failed'}`,
      });
    }

    send({
      event: 'done',
      ok: result.ok,
      direction: 'ERP → Tally',
      duration,
      records: result.records,
      message: result.ok
        ? `✅ PO Export completed in ${duration} — ${result.records} invoices processed`
        : `❌ PO Export failed: ${result.error}`,
    });

    await TallyConfig.findOneAndUpdate({}, { lastExportAt: new Date() }, { sort: { _id: 1 } }).catch(() => {});

  } catch (err) {
    send({ event: 'error', message: `PO Export failed: ${err.message}` });
  }

  res.end();
};

// ─── PO INVOICE EXPORT COUNT ──────────────────────────────────────────────────
/**
 * GET /api/tally/po-export-count
 * Returns the number of PO Invoices pending Tally export.
 */
export const getPOExportCount = async (req, res) => {
  try {
    const count = await getPOInvoiceExportCount();
    res.json({ success: true, data: { poInvoices: { label: 'PO Invoices (pending)', count } } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
