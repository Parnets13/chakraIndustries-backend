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

// ── STOCK ITEMS — collection fetch (all at once) ──────────────────────────────
//
// Replaces the old two-step approach (name-list report → per-item report) which
// used REPORTNAME="List of Stock Items" — a report that does not exist in Tally
// and caused: "Could not find Report 'List of Stock Items'!"
//
// Now uses a single Collection-based Export request with TYPE=StockItem so Tally
// returns all items with full detail in one response.

function buildStockItemCollectionXml(company) {
  const companyTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllStockItems</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${companyTag}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllStockItems">
            <TYPE>StockItem</TYPE>
            <FETCH>*</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

async function syncStockItems(url, cfg, onProgress) {
  const company = (cfg.companyName || process.env.TALLY_COMPANY || 'SRI CHAKRA INDUSTRIES').trim();

  onProgress({ event: 'phase', entity: 'Items', message: 'Fetching stock items from Tally (collection)...' });

  // Single collection request — returns all stock items with full detail
  const collectionXml = buildStockItemCollectionXml(company);
  let resp = await post(url, collectionXml, 90000);

  // Fallback: try alternate collection name if the first returned nothing
  if (!resp || !resp.includes('<STOCKITEM')) {
    LOG('Primary collection (AllStockItems) returned no items, trying StockItems...');
    const fallbackXml = buildStockItemCollectionXml(company).replace(/AllStockItems/g, 'StockItems');
    resp = await post(url, fallbackXml, 90000);
  }

  if (!resp || !resp.includes('<STOCKITEM')) {
    onProgress({ event: 'phase_done', entity: 'Items', saved: 0, message: 'No stock items found in Tally.' });
    return 0;
  }

  const matches = [...resp.matchAll(/<STOCKITEM([^>]*)>([\s\S]*?)<\/STOCKITEM>/gi)];
  const total = matches.length;

  if (!total) {
    onProgress({ event: 'phase_done', entity: 'Items', saved: 0, message: 'No stock items parsed from Tally response.' });
    return 0;
  }

  onProgress({ event: 'phase', entity: 'Items', total, message: `Found ${total} stock items — saving...` });

  const UNIT_MAP = { Nos:'units', Kg:'kg', Ltr:'liter', Mtr:'meter', Box:'box', Pcs:'piece' };
  let saved = 0;

  for (let i = 0; i < matches.length; i++) {
    const attrs = matches[i][1];
    const block = matches[i][2];

    // Extract name: prefer NAME attribute on the tag, then inner tags
    let name = '';
    const nameAttr = attrs.match(/NAME="([^"]*)"/i);
    if (nameAttr) name = decodeXml(nameAttr[1].trim());
    if (!name) {
      const langNameMatch = block.match(/<LANGUAGENAME\.LIST>[\s\S]*?<NAME\.LIST[\s\S]*?<NAME>([\s\S]*?)<\/NAME>/i);
      if (langNameMatch) name = decodeXml(langNameMatch[1].trim());
    }
    if (!name) {
      const innerName = block.match(/<NAME[^>]*>([\s\S]*?)<\/NAME>/i);
      if (innerName) name = decodeXml(innerName[1].trim());
    }
    if (!name) continue;

    const guid    = gGuid(block);
    const alterId = gAlter(block);
    const hsn     = gVal(block, 'HSNCODE');
    const gstRate = parseFloat(gVal(block, 'GSTRATE')) || 0;
    const rawUnit = gVal(block, 'BASEUNITS') || 'Nos';
    const unit    = UNIT_MAP[rawUnit] || 'units';
    const cost    = parseFloat(gVal(block, 'STANDARDCOST')) || 0;

    // Use full GUID as identifier — no truncation
    const cleanGuid = guid ? guid.replace(/[^A-Z0-9]/gi, '') : null;
    const sku    = cleanGuid ? `TALLY-${cleanGuid}` : name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 30);
    const itemId = cleanGuid ? `TALLY-${cleanGuid}` : `TALLY-${sku}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

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
            itemId, sku,
            name, sellingPrice: cost,
          },
        },
        { upsert: true }
      );
      saved++;
    } catch (e) {
      LOG(`ItemMaster upsert error for "${name}":`, e.message);
    }

    onProgress({
      event  : 'record',
      entity : 'Items',
      name,
      index  : i + 1,
      total,
      saved,
    });
  }

  onProgress({ event: 'phase_done', entity: 'Items', saved, total });
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
    // Parse closing balance if available from Tally
    const cbRaw   = gVal(block, 'CLOSINGBALANCE');
    const cbBal   = cbRaw ? parseFloat(cbRaw) : null;
    const email   = decodeXml(gVal(block, 'EMAIL') || gVal(block, 'LEDGEREMAIL') || gVal(block, 'MAILINGEMAIL'));
    const phone   = decodeXml(
      gVal(block, 'LEDGERMOBILE') ||
      gVal(block, 'MOBILE')       ||
      gVal(block, 'MOBILENO')     ||
      gVal(block, 'TELEPHONE')    ||
      gVal(block, 'PHONE')        ||
      gVal(block, 'PHONENO')      ||
      gVal(block, 'CONTACT')
    );
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
            // Set closing balance if available from Tally, otherwise will be calculated later from vouchers
            ...(cbBal !== null ? { closingBalance: cbBal, closingBalanceType: cbBal >= 0 ? 'Dr' : 'Cr', closingBalanceCalculatedAt: new Date() } : {}),
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
      // Only store a valid 10-digit number; fall back to empty string (never store placeholder)
      const sp = cleanPhone.length === 10 ? cleanPhone : '';
      const se = email || `${name.replace(/\s+/g,'').toLowerCase().slice(0,30)}@tally.sync`;

      if (isCred) {
        try {
          await Vendor.findOneAndUpdate(
            guid ? { tallyGuid: guid } : { companyName: name },
            {
              $set: {
                tallySynced: true, lastTallySync: new Date(),
                ...(sp ? { phone: sp } : {}), ...(email ? { email: se } : {}),
                ...(contactPerson ? { contactPerson } : {}), ...(tallyAddress ? { address: tallyAddress } : {}),
                ...(tallyCity  ? { city: tallyCity }   : {}), ...(tallyState ? { state: tallyState } : {}),
                ...(gstNum ? { gstNumber: gstNum } : {}),
                ...(guid ? { tallyGuid: guid } : {}), ...(alterId ? { tallyAlterId: alterId } : {}),
              },
              $setOnInsert: {
                vendorId: `VND-TALLY-${i}`, companyName: name, category: 'General',
                contactPerson: contactPerson || name, phone: sp || '',  email: se,
                address: tallyAddress || 'Imported from Tally',
                ...(tallyCity  ? { city: tallyCity }   : {}),
                ...(tallyState ? { state: tallyState } : {}),
                pincode: '000000', status: 'Active',
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
                ...(sp ? { phone: sp } : {}), ...(email ? { email: se } : {}),
                ...(contactPerson ? { contact: contactPerson } : {}),
                ...(tallyAddress ? { address: tallyAddress } : {}), ...(tallyCity ? { city: tallyCity } : {}),
                ...(gstNum ? { gstNumber: gstNum } : {}),
                ...(guid ? { tallyGuid: guid } : {}), ...(alterId ? { tallyAlterId: alterId } : {}),
              },
              $setOnInsert: {
                clientId: `CLT-TALLY-${i}`, name, contact: contactPerson || name,
                phone: sp || '', email: se,
                ...(tallyCity ? { city: tallyCity } : {}),
                category: 'Trading', status: 'Active',
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
      const narrn   = gVal(block, 'NARRATION');
      const vDate   = rawDate.length === 8
        ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`)
        : new Date();

      try {
        // Parse ledger entries
        const le = [];
        for (const lex of block.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi)) {
          const lb = lex[1];
          const ln = gVal(lb, 'LEDGERNAME');
          if (ln) le.push({ ledgerName: ln, amount: parseFloat(gVal(lb, 'AMOUNT')) || 0, isDeemed: gVal(lb, 'ISDEEMEDPOSITIVE') === 'Yes' });
        }

        // Parse inventory entries — Tally Sales/Purchase use ALLINVENTORYENTRIES.LIST
        const ie = [];
        const invPattern = /<ALLINVENTORYENTRIES\.LIST>([\s\S]*?)<\/ALLINVENTORYENTRIES\.LIST>|<INVENTORYENTRIES\.LIST>([\s\S]*?)<\/INVENTORYENTRIES\.LIST>/gi;
        for (const inv of block.matchAll(invPattern)) {
          const ib = inv[1] || inv[2];
          const sn = gVal(ib, 'STOCKITEMNAME');
          if (!sn) continue;
          // BILLEDQTY / ACTUALQTY — may be "1 Nos" → strip unit
          const rawQty  = gVal(ib, 'BILLEDQTY') || gVal(ib, 'ACTUALQTY') || '0';
          const rawRate = gVal(ib, 'RATE') || '0';
          const qty  = parseFloat(rawQty.replace(/[^\d.-]/g, ''))  || 0;
          const rate = parseFloat(rawRate.replace(/[^\d.-]/g, '')) || 0;
          const amt  = Math.abs(parseFloat(gVal(ib, 'AMOUNT')) || 0);
          ie.push({ stockItemName: sn, qty, rate, amount: amt });
        }

        // ── Amount calculation ────────────────────────────────────────────
        // Priority 1: sum inventory items + tax ledgers (Sales/Purchase)
        // Priority 2: max absolute ledger amount (Payment/Receipt/Journal)
        // Priority 3: top-level AMOUNT fallback
        let computedAmount = 0;
        if (ie.length > 0) {
          const itemTotal = ie.reduce((s, i) => s + i.amount, 0);
          const taxTotal  = le.reduce((s, l) => {
            const n = l.ledgerName.toLowerCase();
            if (n.includes('cgst') || n.includes('sgst') || n.includes('igst') ||
                n.includes('tax') || n.includes('gst') || n.includes('round')) {
              return s + Math.abs(l.amount);
            }
            return s;
          }, 0);
          computedAmount = itemTotal + taxTotal;
        } else if (le.length > 0) {
          computedAmount = Math.max(...le.map(l => Math.abs(l.amount)));
          if (!isFinite(computedAmount)) computedAmount = 0;
        }
        const finalAmount = computedAmount > 0 ? computedAmount : Math.abs(parseFloat(gVal(block, 'AMOUNT')) || 0);

        const filter = guid ? { tallyGuid: guid } : (vNo ? { voucherNumber: vNo, voucherType: vtype } : null);
        if (!filter) continue;

        await TallyVoucher.findOneAndUpdate(
          filter,
          {
            $set: {
              voucherType: vtype,
              voucherNumber: vNo || `TALLY-${Date.now()}`,
              partyName: party,
              partyLedgerName: party,
              amount: finalAmount,
              narration: narrn,
              voucherDate: vDate,
              ledgerEntries: le,
              inventoryEntries: ie,
              source: 'Tally',
              syncedAt: new Date(),
              ...(guid    ? { tallyGuid: guid }      : {}),
              ...(alterId ? { tallyAlterId: alterId } : {}),
            },
          },
          { upsert: true }
        );

        // Mirror Sales & Purchase into Invoice so they appear in the Invoices page
        if ((vtype === 'Sales' || vtype === 'Purchase') && vNo) {
          await Invoice.findOneAndUpdate(
            guid ? { tallyGuid: guid } : { invoiceNo: vNo },
            {
              $set: {
                partyName: party,
                grandTotal: finalAmount,
                ...(guid    ? { tallyGuid: guid }      : {}),
                ...(alterId ? { tallyAlterId: alterId } : {}),
              },
              $setOnInsert: {
                invoiceNo: vNo,
                partyName: party,
                invoiceDate: vDate,
                grandTotal: amount,
                source: 'Tally',
                status: 'Sent',
                invoiceType: 'single',
                items: [],
              },
            },
            { upsert: true }
          ).catch(e => LOG(`Invoice mirror error (${vtype} ${vNo}): ${e.message}`));
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
  const modules = [];
  const startedAt = Date.now();

  try {
    if (t === 'full' || t === 'items') {
      const s = await syncStockItems(url, cfg, onProgress);
      totalSaved += s;
      modules.push({ name: 'Items', count: s, created: s, updated: 0, timestamp: new Date(), route: '/item-master' });
    }
    if (t === 'full' || t === 'ledgers') {
      const s = await syncLedgers(url, cfg, onProgress);
      totalSaved += s;
      modules.push({ name: 'Ledgers', count: s, created: s, updated: 0, timestamp: new Date(), route: '/finance/tally-ledger' });
    }
    if (t === 'full' || t === 'vouchers') {
      const s = await syncVouchers(url, cfg, onProgress);
      totalSaved += s;
      modules.push({ name: 'Vouchers', count: s, created: s, updated: 0, timestamp: new Date(), route: '/finance/tally-ledger' });
    }

    const duration = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

    // Log to DB — now with per-module breakdown
    await TallySyncLog.create({
      syncId      : `STREAM-${Date.now()}`,
      type        : type === 'Full' ? 'Full' : type,
      direction   : 'Tally → ERP',
      status      : 'Success',
      records     : totalSaved,
      duration,
      modules,
      triggeredBy : triggeredBy || null,
    }).catch(() => {});

    await TallyConfig.findOneAndUpdate({}, { $set: { lastSyncAt: new Date(), connectionStatus: 'Connected' } }, { upsert: true });

    onProgress({ event: 'summary', totalSaved, message: `All done — ${totalSaved} records saved to ERP` });

  } catch (err) {
    LOG('runStreamingSync error:', err.message);
    onProgress({ event: 'error', message: err.message });

    await TallySyncLog.create({
      syncId      : `STREAM-${Date.now()}`,
      type        : 'Full',
      direction   : 'Tally → ERP',
      status      : 'Failed',
      error       : err.message,
      records     : totalSaved,
      duration    : `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      modules,
      triggeredBy : triggeredBy || null,
    }).catch(() => {});

    throw err;
  }
}
