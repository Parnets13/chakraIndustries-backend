/**
 * tallySyncStream.js
 *
 * One-record-at-a-time streaming sync engine.
 * Fetches names from Tally first, then pulls and saves each record individually.
 * Reports progress via onProgress(event) callback — used by the SSE endpoint.
 *
 * Entities synced in order:
 *   1. Stock Items   → ItemMaster
 *   2. Ledgers       → AccountsLedger + Vendor + Client
 *   3. Vouchers      → TallyVoucher + Invoice  (monthly chunks)
 */

import axios        from 'axios';
import ItemMaster     from '../models/ItemMaster.js';
import AccountsLedger from '../models/AccountsLedger.js';
import Vendor         from '../models/Vendor.js';
import Client         from '../models/Client.js';
import TallyVoucher   from '../models/TallyVoucher.js';
import Invoice        from '../models/Invoice.js';
import TallyConfig    from '../models/TallyConfig.js';
import TallySyncLog   from '../models/TallySyncLog.js';

const LOG = (...a) => console.log('[SyncStream]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── URL helpers ───────────────────────────────────────────────────────────────

function buildUrl(cfg) {
  const local = (cfg.tallyLocalUrl || '').trim();
  const port  = cfg.port || '9000';
  if (!local) throw new Error('tallyLocalUrl not set');
  if (local.startsWith('https://') || local.match(/:\d+$/)) return local.replace(/\/$/, '');
  return `${local.replace(/\/$/, '')}:${port}`;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function decodeXml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&quot;/gi,'"').replace(/&apos;/gi,"'");
}

const gGuid    = b => b.match(/<GUID>(.*?)<\/GUID>/i)?.[1]?.trim()            || null;
const gAlter   = b => b.match(/<ALTERID[^>]*>(.*?)<\/ALTERID>/i)?.[1]?.trim() || null;
const gVal     = (b,t) => b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'))?.[1]?.trim() || '';
const fmtDate  = d => { const dt = d instanceof Date ? d : new Date(d); return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`; };

// ── HTTP POST ─────────────────────────────────────────────────────────────────

async function post(url, xml, timeoutMs = 45000) {
  try {
    const r = await axios({
      method: 'POST', url, data: xml,
      headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
      timeout: timeoutMs, responseType: 'text', validateStatus: () => true,
      maxContentLength: Infinity, maxBodyLength: Infinity,
    });
    return typeof r.data === 'string' ? r.data : String(r.data || '');
  } catch (e) {
    LOG('POST error:', e.message);
    return '';
  }
}

// ── STOCK ITEMS — one by one ──────────────────────────────────────────────────

async function syncStockItems(url, cfg, onProgress) {
  const company = cfg.companyName || process.env.TALLY_COMPANY || 'SRI CHAKRA INDUSTRIES';

  onProgress({ event: 'phase', entity: 'Items', message: 'Fetching stock item list from Tally...' });

  // 1. Get name list
  const listXml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Stock Items</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
  const listResp = await post(url, listXml, 60000);

  let names = [];
  const nameMatches = [...(listResp || '').matchAll(/<STOCKITEM[^>]+NAME="([^"]+)"/gi)];
  const seen = new Set();
  names = nameMatches.map(m => m[1]?.trim()).filter(n => n && !seen.has(n) && seen.add(n));

  if (!names.length) {
    onProgress({ event: 'phase_done', entity: 'Items', saved: 0, message: 'No stock items found in Tally.' });
    return 0;
  }

  onProgress({ event: 'phase', entity: 'Items', total: names.length, message: `Found ${names.length} stock items — syncing one by one...` });

  let saved = 0;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];

    // Fetch detail for this single item
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Stock Item</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><STOCKITEMNAME>${esc(name)}</STOCKITEMNAME></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

    const resp = await post(url, xml, 30000);

    let guid = null, alterId = null, hsn = '', gstRate = 0, unit = 'units', cost = 0;
    if (resp?.includes('<STOCKITEM')) {
      const m = resp.match(/<STOCKITEM[^>]*>([\s\S]*?)<\/STOCKITEM>/i);
      if (m) {
        const block = m[1];
        guid    = gGuid(block);
        alterId = gAlter(block);
        hsn     = gVal(block, 'HSNCODE');
        gstRate = parseFloat(gVal(block, 'GSTRATE')) || 0;
        const rawUnit = gVal(block, 'BASEUNITS') || 'Nos';
        unit    = { Nos:'units', Kg:'kg', Ltr:'liter', Mtr:'meter', Box:'box', Pcs:'piece' }[rawUnit] || 'units';
        cost    = parseFloat(gVal(block, 'STANDARDCOST')) || 0;
      }
    }

    const sku     = name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 30);
    const barcode = guid ? `TALLY-${guid.replace(/[^A-Z0-9]/gi,'').slice(0,20)}` : `TALLY-${sku}-${i}`;

    try {
      await ItemMaster.findOneAndUpdate(
        guid ? { tallyGuid: guid } : { name },
        {
          $set: {
            hsn, gst: gstRate, unit, costPrice: cost, unitPrice: cost,
            tallySynced: true, lastTallySync: new Date(),
            status: 'Active', isActive: true,
            ...(guid    ? { tallyGuid: guid }      : {}),
            ...(alterId ? { tallyAlterId: alterId } : {}),
          },
          $setOnInsert: {
            itemId: `TALLY-${sku}-${i}`, sku: `${sku}-${i}`,
            name, sellingPrice: cost, barcode,
          },
        },
        { upsert: true }
      );
      saved++;
    } catch (e) {
      LOG(`ItemMaster upsert error for "${name}":`, e.message);
    }

    // Emit one-by-one progress
    onProgress({
      event  : 'record',
      entity : 'Items',
      name,
      index  : i + 1,
      total  : names.length,
      saved,
    });

    await sleep(80); // small pause to avoid overwhelming Tally
  }

  onProgress({ event: 'phase_done', entity: 'Items', saved, total: names.length });
  return saved;
}

// ── LEDGERS — one by one ──────────────────────────────────────────────────────

async function syncLedgers(url, cfg, onProgress) {
  const company = cfg.companyName || process.env.TALLY_COMPANY || 'SRI CHAKRA INDUSTRIES';

  onProgress({ event: 'phase', entity: 'Ledgers', message: 'Fetching ledger list from Tally...' });

  const listXml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Ledgers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
  const listResp = await post(url, listXml, 60000);

  let names = [];
  const seen = new Set();
  const matches = [...(listResp || '').matchAll(/<LEDGER[^>]+NAME="([^"]+)"/gi)];
  names = matches.map(m => decodeXml(m[1]?.trim())).filter(n => n && !seen.has(n) && seen.add(n));

  if (!names.length) {
    onProgress({ event: 'phase_done', entity: 'Ledgers', saved: 0, message: 'No ledgers found in Tally.' });
    return 0;
  }

  onProgress({ event: 'phase', entity: 'Ledgers', total: names.length, message: `Found ${names.length} ledgers — syncing one by one...` });

  let lSaved = 0, vSaved = 0, cSaved = 0;

  for (let i = 0; i < names.length; i++) {
    const name = names[i];

    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Ledger</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><LEDGERNAME>${esc(name)}</LEDGERNAME></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

    const resp = await post(url, xml, 30000);

    let block = '';
    if (resp?.includes('<LEDGER')) {
      const m = resp.match(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/i);
      if (m) block = m[1];
    }

    const guid    = gGuid(block);
    const alterId = gAlter(block);
    const parent  = decodeXml(gVal(block, 'PARENT'));
    const gstNum  = decodeXml(gVal(block, 'PARTYGSTIN'));
    const obBal   = parseFloat(gVal(block, 'OPENINGBALANCE')) || 0;
    const email   = decodeXml(gVal(block, 'EMAIL'));
    const phone   = decodeXml(gVal(block, 'LEDGERMOBILE'));
    const contactPerson = decodeXml(gVal(block, 'MAILINGNAME'));
    const addrLines = block ? [...block.matchAll(/<ADDRESS>([\s\S]*?)<\/ADDRESS>/gi)].map(a => decodeXml(a[1].trim())).filter(Boolean) : [];
    const tallyAddress = addrLines.slice(0, 2).join(', ');
    const tallyCity  = decodeXml(gVal(block, 'LEDGERCITY'));
    const tallyState = decodeXml(gVal(block, 'STATENAME') || gVal(block, 'LEDGERSTATE'));
    const lCode = `TALLY-${name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,20)}-${i % 10000}`;

    const isCred = /creditor|sundry.c/i.test(parent);
    const isDebt = /debtor|sundry.d/i.test(parent);

    try {
      await AccountsLedger.findOneAndUpdate(
        guid ? { tallyGuid: guid } : { ledgerName: name },
        {
          $set: {
            openingBalance: obBal, syncedWithTally: true, lastTallySync: new Date(),
            ledgerGroup: isCred ? 'Sundry Creditors' : isDebt ? 'Sundry Debtors' : (parent || 'General'),
            ...(email ? { email } : {}), ...(phone ? { phone } : {}),
            ...(gstNum ? { gstNumber: gstNum } : {}),
            ...(tallyAddress ? { 'address.street': tallyAddress } : {}),
            ...(tallyCity   ? { 'address.city': tallyCity }    : {}),
            ...(tallyState  ? { 'address.state': tallyState }  : {}),
            ...(guid    ? { tallyGuid: guid }      : {}),
            ...(alterId ? { tallyAlterId: alterId } : {}),
          },
          $setOnInsert: { ledgerCode: lCode, ledgerName: name, contactPerson: contactPerson || name, panNumber: 'N/A', isActive: true },
        },
        { upsert: true }
      );
      lSaved++;
    } catch (e) { LOG(`Ledger upsert error for "${name}":`, e.message); }

    // Vendor / Client cross-save
    if (isCred || isDebt) {
      const rawPhone = String(phone || '').replace(/\D/g, '');
      let cleanPhone = rawPhone;
      if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) cleanPhone = cleanPhone.slice(2);
      if (cleanPhone.length === 11 && cleanPhone.startsWith('0'))  cleanPhone = cleanPhone.slice(1);
      const sp = cleanPhone.length === 10 ? cleanPhone : (rawPhone.slice(0, 15) || '0000000000');
      const se = email || `${name.replace(/\s+/g,'').toLowerCase().slice(0,30)}@tally.sync`;

      if (isCred) {
        try {
          await Vendor.findOneAndUpdate(
            guid ? { tallyGuid: guid } : { companyName: name },
            {
              $set: {
                tallySynced: true, lastTallySync: new Date(),
                ...(sp !== '0000000000' ? { phone: sp } : {}), ...(email ? { email: se } : {}),
                ...(contactPerson ? { contactPerson } : {}), ...(tallyAddress ? { address: tallyAddress } : {}),
                ...(tallyCity  ? { city: tallyCity }   : {}), ...(tallyState ? { state: tallyState } : {}),
                ...(gstNum ? { gstNumber: gstNum } : {}),
                ...(guid ? { tallyGuid: guid } : {}), ...(alterId ? { tallyAlterId: alterId } : {}),
              },
              $setOnInsert: {
                vendorId: `VND-TALLY-${i}`, companyName: name, category: 'General',
                contactPerson: contactPerson || name, phone: sp, email: se,
                address: tallyAddress || 'Imported from Tally', city: tallyCity || 'Unknown',
                state: tallyState || 'Unknown', pincode: '000000', status: 'Active',
              },
            },
            { upsert: true }
          );
          vSaved++;
        } catch (e) { LOG(`Vendor upsert error for "${name}":`, e.message); }
      } else {
        try {
          await Client.findOneAndUpdate(
            guid ? { tallyGuid: guid } : { name },
            {
              $set: {
                tallySynced: true, lastTallySync: new Date(),
                ...(sp !== '0000000000' ? { phone: sp } : {}), ...(email ? { email: se } : {}),
                ...(contactPerson ? { contact: contactPerson } : {}),
                ...(tallyAddress ? { address: tallyAddress } : {}), ...(tallyCity ? { city: tallyCity } : {}),
                ...(gstNum ? { gstNumber: gstNum } : {}),
                ...(guid ? { tallyGuid: guid } : {}), ...(alterId ? { tallyAlterId: alterId } : {}),
              },
              $setOnInsert: {
                clientId: `CLT-TALLY-${i}`, name, contact: contactPerson || name,
                phone: sp, email: se, city: tallyCity || 'Unknown', category: 'Trading', status: 'Active',
              },
            },
            { upsert: true }
          );
          cSaved++;
        } catch (e) { LOG(`Client upsert error for "${name}":`, e.message); }
      }
    }

    onProgress({
      event  : 'record',
      entity : 'Ledgers',
      name,
      index  : i + 1,
      total  : names.length,
      saved  : lSaved,
      extra  : `Vendors: ${vSaved} | Clients: ${cSaved}`,
    });

    await sleep(80);
  }

  onProgress({ event: 'phase_done', entity: 'Ledgers', saved: lSaved, vendors: vSaved, clients: cSaved, total: names.length });
  return lSaved + vSaved + cSaved;
}

// ── VOUCHERS — monthly chunks, one month at a time ────────────────────────────

async function syncVouchers(url, cfg, onProgress) {
  const company = cfg.companyName || process.env.TALLY_COMPANY || 'SRI CHAKRA INDUSTRIES';

  // Build 2-year monthly chunks
  const chunks = [];
  const today  = new Date();
  let   cursor = new Date();
  cursor.setFullYear(cursor.getFullYear() - 2);
  cursor.setDate(1);
  while (cursor <= today) {
    const from = new Date(cursor);
    const to   = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    if (to > today) to.setTime(today.getTime());
    chunks.push({ from: fmtDate(from), to: fmtDate(to), label: `${from.toLocaleString('en-IN',{month:'short',year:'numeric'})}` });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  onProgress({ event: 'phase', entity: 'Vouchers', total: chunks.length, message: `Syncing vouchers — ${chunks.length} months of data...` });

  let totalSaved = 0;

  for (let ci = 0; ci < chunks.length; ci++) {
    const { from, to, label } = chunks[ci];

    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>${from}</SVFROMDATE><SVTODATE>${to}</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

    const resp = await post(url, xml, 60000);
    if (!resp?.includes('<VOUCHER')) {
      onProgress({ event: 'record', entity: 'Vouchers', name: label, index: ci+1, total: chunks.length, saved: totalSaved, extra: '0 vouchers' });
      await sleep(200);
      continue;
    }

    const allV = [...resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
    let chunkSaved = 0;

    for (const match of allV) {
      const block   = match[1];
      const vtype   = gVal(block, 'VOUCHERTYPENAME') || gVal(block, 'VCHTYPE') || 'Other';
      const guid    = gGuid(block);
      const alterId = gAlter(block);
      const vNo     = gVal(block, 'VOUCHERNUMBER');
      const party   = gVal(block, 'PARTYLEDGERNAME');
      const rawDate = gVal(block, 'DATE');
      const amount  = Math.abs(parseFloat(gVal(block, 'AMOUNT')) || 0);
      const narrn   = gVal(block, 'NARRATION');
      const vDate   = rawDate.length === 8
        ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`)
        : new Date();

      try {
        if (vtype === 'Sales' || vtype === 'Purchase') {
          if (!vNo) continue;
          await Invoice.findOneAndUpdate(
            guid ? { tallyGuid: guid } : { invoiceNo: vNo },
            {
              $set: { ...(guid ? { tallyGuid: guid } : {}), ...(alterId ? { tallyAlterId: alterId } : {}) },
              $setOnInsert: { invoiceNo: vNo, partyName: party, invoiceDate: vDate, grandTotal: amount, source: 'manual', status: 'Sent', invoiceType: 'single', items: [] },
            },
            { upsert: true }
          );
        } else {
          const le = [];
          for (const lex of block.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi)) {
            const lb = lex[1];
            const ln = gVal(lb, 'LEDGERNAME');
            if (ln) le.push({ ledgerName: ln, amount: parseFloat(gVal(lb, 'AMOUNT')) || 0, isDeemed: gVal(lb, 'ISDEEMEDPOSITIVE') === 'Yes' });
          }
          const filter = guid ? { tallyGuid: guid } : (vNo ? { voucherNumber: vNo, voucherType: vtype } : null);
          if (!filter) continue;
          await TallyVoucher.findOneAndUpdate(
            filter,
            {
              $set: { amount, narration: narrn, voucherDate: vDate, ledgerEntries: le, source: 'Tally', syncedAt: new Date(), ...(guid ? { tallyGuid: guid } : {}), ...(alterId ? { tallyAlterId: alterId } : {}) },
              $setOnInsert: { voucherType: vtype, voucherNumber: vNo || `TALLY-${Date.now()}`, partyName: party },
            },
            { upsert: true }
          );
        }
        chunkSaved++;
        totalSaved++;
      } catch (e) { LOG(`Voucher upsert error (${vtype} ${vNo}):`, e.message); }
    }

    onProgress({
      event  : 'record',
      entity : 'Vouchers',
      name   : label,
      index  : ci + 1,
      total  : chunks.length,
      saved  : totalSaved,
      extra  : `${chunkSaved} vouchers this month`,
    });

    await sleep(300);
  }

  onProgress({ event: 'phase_done', entity: 'Vouchers', saved: totalSaved, total: chunks.length });
  return totalSaved;
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

/**
 * runStreamingSync
 * @param {object}   opts
 * @param {string}   opts.type          - 'Full' | 'Items' | 'Ledgers' | 'Vouchers'
 * @param {object}   opts.cfg           - TallyConfig document
 * @param {*}        opts.triggeredBy   - user id (for logs)
 * @param {Function} opts.onProgress    - callback(event) for SSE streaming
 */
export async function runStreamingSync({ type = 'Full', cfg, triggeredBy, onProgress }) {
  const url = (() => {
    const local = (cfg.tallyLocalUrl || '').trim();
    const port  = cfg.port || '9000';
    if (!local) throw new Error('tallyLocalUrl not set');
    if (local.startsWith('https://') || local.match(/:\d+$/)) return local.replace(/\/$/, '');
    return `${local.replace(/\/$/, '')}:${port}`;
  })();

  LOG(`runStreamingSync type=${type} url=${url}`);

  const t = type.toLowerCase();
  let totalSaved = 0;

  try {
    if (t === 'full' || t === 'items') {
      totalSaved += await syncStockItems(url, cfg, onProgress);
    }
    if (t === 'full' || t === 'ledgers') {
      totalSaved += await syncLedgers(url, cfg, onProgress);
    }
    if (t === 'full' || t === 'vouchers') {
      totalSaved += await syncVouchers(url, cfg, onProgress);
    }

    // Log to DB
    await TallySyncLog.create({
      syncId    : `STREAM-${Date.now()}`,
      type      : type === 'Full' ? 'Full' : type,
      direction : 'Tally → ERP',
      status    : 'Success',
      records   : totalSaved,
      duration  : '(streaming)',
      triggeredBy: triggeredBy || null,
    }).catch(() => {});

    await TallyConfig.findOneAndUpdate({}, { $set: { lastSyncAt: new Date(), connectionStatus: 'Connected' } }, { upsert: true });

    onProgress({ event: 'summary', totalSaved, message: `All done — ${totalSaved} records saved to ERP` });

  } catch (err) {
    LOG('runStreamingSync error:', err.message);
    onProgress({ event: 'error', message: err.message });

    await TallySyncLog.create({
      syncId    : `STREAM-${Date.now()}`,
      type      : 'Full',
      direction : 'Tally → ERP',
      status    : 'Failed',
      error     : err.message,
      records   : totalSaved,
      duration  : '(streaming)',
      triggeredBy: triggeredBy || null,
    }).catch(() => {});

    throw err;
  }
}
