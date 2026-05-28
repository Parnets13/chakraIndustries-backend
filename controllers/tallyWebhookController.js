/**
 * tallyWebhookController.js
 *
 * Receives XML data pushed FROM Tally to the ERP.
 * Tally can be configured (via TDL or Tally.ini) to POST XML to:
 *   POST http://<erp-host>/api/tally/webhook
 *
 * The webhook accepts raw XML body and parses it to update ERP data.
 * Secured by an optional shared secret in the X-Tally-Secret header.
 */

import express from 'express';
import TallyConfig from '../models/TallyConfig.js';
import TallySyncLog from '../models/TallySyncLog.js';
import ItemMaster from '../models/ItemMaster.js';
import AccountsLedger from '../models/AccountsLedger.js';
import Invoice from '../models/Invoice.js';

// Parse raw XML body for the webhook route
export const rawXmlParser = express.raw({ type: 'text/xml', limit: '10mb' });

/** Write a sync log entry */
async function writeLog({ syncId, type, entity, direction, status, duration, error, records }) {
  try {
    await TallySyncLog.create({ syncId, type, entity, direction, status, duration, error: error || '', records });
  } catch (_) { /* non-fatal */ }
}

/**
 * POST /api/tally/webhook
 * Accepts XML pushed by Tally and upserts data into ERP.
 */
export const tallyWebhook = async (req, res) => {
  const start = Date.now();
  const syncId = `WEBHOOK-${Date.now()}`;

  try {
    // Optional shared-secret check
    const cfg = await TallyConfig.findOne();
    if (cfg?.apiKey && cfg.authType === 'API Key') {
      const secret = req.headers['x-tally-secret'] || req.headers['authorization']?.replace('Bearer ', '');
      if (secret !== cfg.apiKey) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
    }

    // Body can be Buffer (raw) or string
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (req.body || '');
    if (!rawBody) {
      return res.status(400).json({ success: false, message: 'Empty body' });
    }

    let records = 0;
    let type = 'Full';

    // ── Detect and process STOCK ITEMS ──────────────────────────────────────
    if (rawBody.includes('<STOCKITEM')) {
      type = 'Item Master';
      const itemMatches = [...rawBody.matchAll(/<STOCKITEM[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/STOCKITEM>/gi)];
      const upsertOps = [];
      for (const match of itemMatches) {
        const name = match[1]?.trim();
        if (!name) continue;
        const block = match[2];
        const hsnMatch = block.match(/<HSNCODE>(.*?)<\/HSNCODE>/i);
        const gstMatch = block.match(/<GSTRATE>(.*?)<\/GSTRATE>/i);
        const unitMatch = block.match(/<BASEUNITS>(.*?)<\/BASEUNITS>/i);
        const rateMatch = block.match(/<STANDARDCOST>(.*?)<\/STANDARDCOST>/i);

        const hsn = hsnMatch?.[1]?.trim() || '';
        const gst = parseFloat(gstMatch?.[1]) || 0;
        const unit = unitMatch?.[1]?.trim() || 'units';
        const costPrice = parseFloat(rateMatch?.[1]) || 0;
        const unitMap = { 'Nos': 'units', 'Kg': 'kg', 'Ltr': 'liter', 'Mtr': 'meter', 'Box': 'box', 'Pcs': 'piece' };
        const mappedUnit = unitMap[unit] || 'units';
        const sku = name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 30);
        const itemId = `TALLY-${sku}`;

        upsertOps.push({
          updateOne: {
            filter: { name },
            update: {
              $set: { hsn, gst, unit: mappedUnit, costPrice, unitPrice: costPrice },
              $setOnInsert: { itemId, sku, name, sellingPrice: costPrice, isActive: true },
            },
            upsert: true,
          },
        });
      }
      if (upsertOps.length) {
        await ItemMaster.bulkWrite(upsertOps, { ordered: false });
        records = upsertOps.length;
      }
    }

    // ── Detect and process LEDGERS ───────────────────────────────────────────
    if (rawBody.includes('<LEDGER')) {
      type = 'Ledger';
      const ledgerMatches = [...rawBody.matchAll(/<LEDGER[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/LEDGER>/gi)];
      const upsertOps = [];
      for (const match of ledgerMatches) {
        const name = match[1]?.trim();
        if (!name) continue;
        const block = match[2];
        const parentMatch = block.match(/<PARENT>(.*?)<\/PARENT>/i);
        const gstMatch = block.match(/<PARTYGSTIN>(.*?)<\/PARTYGSTIN>/i);
        const balMatch = block.match(/<OPENINGBALANCE>(.*?)<\/OPENINGBALANCE>/i);
        const emailMatch = block.match(/<EMAIL>(.*?)<\/EMAIL>/i);
        const phoneMatch = block.match(/<LEDGERMOBILE>(.*?)<\/LEDGERMOBILE>/i);

        const parent = parentMatch?.[1]?.trim() || '';
        if (!parent.includes('Sundry')) continue;
        const ledgerGroup = parent.includes('Creditor') ? 'Sundry Creditors' : 'Sundry Debtors';
        const ledgerType = parent.includes('Creditor') ? 'Vendor' : 'Customer';
        const gstNumber = gstMatch?.[1]?.trim() || 'N/A';
        const openingBalance = parseFloat(balMatch?.[1]) || 0;
        const email = emailMatch?.[1]?.trim() || '';
        const phone = phoneMatch?.[1]?.trim() || '';
        const ledgerCode = `TALLY-${name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 20)}-${Date.now() % 10000}`;

        upsertOps.push({
          updateOne: {
            filter: { ledgerName: name },
            update: {
              $set: { ledgerGroup, ledgerType, gstNumber, openingBalance, email, phone, syncedWithTally: true, lastTallySync: new Date() },
              $setOnInsert: { ledgerCode, ledgerName: name, contactPerson: name, panNumber: 'N/A', isActive: true },
            },
            upsert: true,
          },
        });
      }
      if (upsertOps.length) {
        await AccountsLedger.bulkWrite(upsertOps, { ordered: false });
        records += upsertOps.length;
      }
    }

    // ── Detect and process SALES VOUCHERS ────────────────────────────────────
    if (rawBody.includes('<VOUCHER') && rawBody.toUpperCase().includes('VCHTYPE="SALES"')) {
      type = 'Sales';
      const voucherMatches = [...rawBody.matchAll(/<VOUCHER[^>]*VCHTYPE="Sales"[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
      const upsertOps = [];
      for (const match of voucherMatches) {
        const block = match[1];
        const vnoMatch = block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i);
        const dateMatch = block.match(/<DATE>(.*?)<\/DATE>/i);
        const partyMatch = block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i);
        const amtMatch = block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i);

        const invoiceNo = vnoMatch?.[1]?.trim();
        if (!invoiceNo) continue;
        const partyName = partyMatch?.[1]?.trim() || 'Unknown';
        const rawDate = dateMatch?.[1]?.trim();
        const grandTotal = Math.abs(parseFloat(amtMatch?.[1])) || 0;
        const invoiceDate = rawDate ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`) : new Date();

        upsertOps.push({
          updateOne: {
            filter: { invoiceNo },
            update: { $setOnInsert: { invoiceNo, partyName, invoiceDate, grandTotal, source: 'manual', status: 'Sent', invoiceType: 'single', items: [] } },
            upsert: true,
          },
        });
      }
      if (upsertOps.length) {
        await Invoice.bulkWrite(upsertOps, { ordered: false });
        records += upsertOps.length;
      }
    }

    const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type, direction: 'Tally → ERP', status: 'Success', duration, records });
    await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date() }, { upsert: true });

    res.json({ success: true, message: `Webhook processed — ${records} records updated`, records });
  } catch (err) {
    const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId: `WEBHOOK-ERR-${Date.now()}`, type: 'Full', direction: 'Tally → ERP', status: 'Failed', duration, error: err.message, records: 0 });
    console.error('[TallyWebhook]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
