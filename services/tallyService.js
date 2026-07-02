/**
 * tallyService.js — Bi-directional ERP ↔ Tally sync engine
 * Tally XML API endpoint: https://erp.majesticmall.net
 *
 * Features:
 *  • ERP → Tally: Customers, Vendors, Products, Invoices, POs, Payments, Receipts
 *  • Tally → ERP: Ledgers, Stock Items, Sales/Purchase Vouchers, Payment/Receipt Vouchers
 *  • GUID / AlterID tracking to prevent duplicate records
 *  • Manual and scheduled sync support
 */

import TallyConfig    from '../models/TallyConfig.js';
import TallySyncLog   from '../models/TallySyncLog.js';
import TallyVoucher   from '../models/TallyVoucher.js';
import ItemMaster     from '../models/ItemMaster.js';
import Vendor         from '../models/Vendor.js';
import Client         from '../models/Client.js';
import CorporateClient from '../models/CorporateClient.js';
import AccountsLedger from '../models/AccountsLedger.js';
import PurchaseOrder  from '../models/PurchaseOrder.js';
import Invoice        from '../models/Invoice.js';
import {
  testTallyConnection as fetchEngineTestConnection,
  checkTallyReachable,
  postXmlWithRetry,
} from './tallyFetchEngine.js';

const LOG = (...a) => console.log('[Tally]', ...a);
const ERR = (...a) => console.error('[Tally ERROR]', ...a);

// ─── CONFIG ───────────────────────────────────────────────────────────────────

async function getConfig() {
  let cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
  if (!cfg) cfg = await TallyConfig.create({});
  return cfg;
}

// ─── XML HELPERS ──────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function tallyDate(d) {
  const dt = d ? new Date(d) : null;
  if (!dt || isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
}

function staticVars(cfg, extra = '') {
  // Tally stores company names as UPPERCASE internally — always send uppercase
  const company = (cfg.companyName || '').trim().toUpperCase();
  const tag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
  return `<STATICVARIABLES>${tag}${extra}</STATICVARIABLES>`;
}

function exportVars(extra = '') {
  return `<STATICVARIABLES>${extra}</STATICVARIABLES>`;
}

const UNIT_MAP = {
  kg:'Kg', kgs:'Kg', kilogram:'Kg', liter:'Ltr', litre:'Ltr', ltr:'Ltr',
  meter:'Mtr', metre:'Mtr', mtr:'Mtr', box:'Box', boxes:'Box',
  piece:'Pcs', pieces:'Pcs', pcs:'Pcs', pc:'Pcs',
  nos:'Nos', no:'Nos', number:'Nos', units:'Nos', unit:'Nos', pack:'Nos', dozen:'Nos',
};
const tallyUnit = (u) => UNIT_MAP[(u||'').toLowerCase().trim()] || 'Nos';

// Extract GUID from Tally XML response (used for duplicate prevention)
function extractGuid(xmlBlock) {
  const m = xmlBlock.match(/<GUID>(.*?)<\/GUID>/i);
  return m ? m[1].trim() : null;
}
function extractAlterId(xmlBlock) {
  const m = xmlBlock.match(/<ALTERID>(.*?)<\/ALTERID>/i) || xmlBlock.match(/<ALTERID\s+[^>]*>(.*?)<\/ALTERID>/i);
  return m ? m[1].trim() : null;
}

// ─── RESPONSE PARSER ─────────────────────────────────────────────────────────

function parseTallyResponse(xml, label = '') {
  if (!xml || !xml.trim()) return { ok: false, error: 'Empty response from Tally' };
  const s = String(xml);

  // Log full raw response for every call — essential for debugging live issues
  LOG(`${label} RAW RESPONSE (first 1000 chars):\n${s.slice(0, 1000)}`);

  const errors = [];
  for (const m of s.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)) {
    const msg = m[1].trim();
    if (msg) {
      errors.push(msg);
      ERR(`${label} LINEERROR: ${msg}`);
    }
  }
  if (s.includes('<ERRORS>')) {
    const m = s.match(/<ERRORS>([\s\S]*?)<\/ERRORS>/i);
    if (m) {
      const msg = m[1].replace(/<[^>]+>/g,' ').trim();
      if (msg) {
        errors.push(msg);
        ERR(`${label} ERRORS tag: ${msg}`);
      }
    }
  }
  const created = parseInt(s.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1] || '0');
  const altered  = parseInt(s.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1] || '0');
  const skipped  = parseInt(s.match(/<SKIPPED>(\d+)<\/SKIPPED>/i)?.[1] || '0');
  LOG(`${label} IMPORTRESULT → created:${created} altered:${altered} skipped:${skipped} errors:${errors.length}`);

  // Warn if Tally altered instead of creating — means voucher numbers collide with existing Tally data
  if (altered > 0 && created === 0) {
    LOG(`${label} ⚠️ WARNING: Tally altered ${altered} records instead of creating new ones. Voucher numbers or master names already exist in Tally.`);
  }

  if (errors.length > 0) {
    if (created === 0 && altered === 0) {
      ERR(`${label} FAILED:`, errors.join(' | '));
      return { ok: false, error: errors.join('; ') };
    }
    LOG(`${label} partial (${created} created, ${altered} altered). Warnings:`, errors.join(' | '));
    return { ok: true, created, altered, warning: errors.join('; ') };
  }
  return { ok: true, created, altered };
}

// ─── PO NUMBER LOOKUP: Fetch existing Tally vouchers indexed by BuyersOrderNo ─
// Used by ERP → Tally push functions to decide Create vs Alter.
//
// Returns an object with TWO maps:
//   byPO       → Map<BuyersOrderNo (uppercase) → { guid, voucherNumber }>
//   byVchNo    → Map<VoucherNumber (uppercase)  → { guid, voucherNumber }>
//
// Why two maps?
//   - Vouchers pushed BEFORE the PO-number change won't have BuyersOrderNo set in Tally.
//     Matching by VoucherNumber (= invoiceNo / poId) catches those and prevents duplicates.
//   - Vouchers pushed AFTER will match by BuyersOrderNo (the primary key going forward).
async function fetchTallyPOMap(cfg) {
  try {
    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';

    const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>ERPVoucherPOLookup</ID>
</HEADER>
<BODY>
  <DESC>
    <STATICVARIABLES>
      ${coTag}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="ERPVoucherPOLookup">
        <TYPE>Voucher</TYPE>
        <FETCH>GUID, VoucherNumber, VoucherTypeName, BuyersOrderNo</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC>
</BODY>
</ENVELOPE>`;

    const resp = await postXmlWithRetry(cfg, xml, 60000);
    if (!resp) return { byPO: new Map(), byVchNo: new Map() };

    const byPO    = new Map();
    const byVchNo = new Map();

    for (const m of resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)) {
      const block = m[1];
      const guid          = (block.match(/<GUID>(.*?)<\/GUID>/i)?.[1]                 || '').trim();
      const voucherNumber = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1] || '').trim();
      const buyersOrderNo = (block.match(/<BUYERSORDERNO>(.*?)<\/BUYERSORDERNO>/i)?.[1] || '').trim();
      if (!guid) continue;

      const entry = { guid, voucherNumber };

      // Primary: index by BuyersOrderNo (the PO number going forward)
      if (buyersOrderNo) {
        byPO.set(buyersOrderNo.toUpperCase().trim(), entry);
      }
      // Fallback: index by VoucherNumber (= invoiceNo / poId from the ERP)
      // This catches vouchers that were pushed before BuyersOrderNo was added.
      if (voucherNumber) {
        byVchNo.set(voucherNumber.toUpperCase().trim(), entry);
      }
    }

    LOG(`fetchTallyPOMap: byPO=${byPO.size} entries, byVchNo=${byVchNo.size} entries`);
    return { byPO, byVchNo };
  } catch (err) {
    ERR('fetchTallyPOMap failed (non-fatal, will default to Create):', err.message);
    return { byPO: new Map(), byVchNo: new Map() }; // Safe fallback → Create
  }
}

// ─── SYNC LOG ─────────────────────────────────────────────────────────────────

async function writeLog({ syncId, type, entity, direction, status, duration, error, records, triggeredBy }) {
  try {
    await TallySyncLog.create({
      syncId, type: type || 'Full', entity: entity || '',
      direction: direction || 'ERP → Tally',
      status, duration: duration || '0s',
      error: error || '', records: records || 0,
      triggeredBy: triggeredBy || null,
    });
  } catch (_) {}
}

// ─── TEST CONNECTION ──────────────────────────────────────────────────────────

export async function testTallyConnection() {
  // Use the improved testTallyConnection from tallyFetchEngine
  return await fetchEngineTestConnection();
}

// ─── PUSH: ALL MASTERS (Items + Customers + Vendors + Ledgers) ────────────────
// Splits into multiple batches to avoid sending a single 3MB+ payload that Tally
// cannot process within the timeout window. Each batch is ≤ MASTER_BATCH_SIZE records.
const MASTER_BATCH_SIZE = 100;  // records per Tally Import Data request
const MASTER_TIMEOUT_MS = 120000; // 2 min per batch — connector round-trip adds latency

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function wrapMastersXml(cfg, bodyXml) {
  return `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
${bodyXml}
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;
}

export async function pushMastersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-MASTERS-${Date.now()}`;
  LOG('=== pushMastersToTally START ===');

  try {
    const [items, vendors, clients, corporateClients, ledgers, pos] = await Promise.all([
      ItemMaster.find({ isActive: true, dataSource: { $ne: 'Tally' } }).lean(),
      Vendor.find({ dataSource: { $ne: 'Tally' } }).lean(),
      Client.find({ status: 'Active', dataSource: { $ne: 'Tally' } }).lean(),
      CorporateClient.find({ status: 'Active', dataSource: { $ne: 'Tally' } }).lean(),
      AccountsLedger.find({ isActive: true, dataSource: { $ne: 'Tally' } }).lean(),
      PurchaseOrder.find({ status: { $in: ['Approved','Received'] } }).lean(),
    ]);

    // ── Build per-record XML fragments ──────────────────────────────────────
    const stockItemFragments = items.map(item => `
<STOCKITEM NAME="${esc(item.name)}" ACTION="${item.tallyGuid ? 'Alter' : 'Create'}">
  <NAME>${esc(item.name)}</NAME>
  <UNITS>${tallyUnit(item.unit)}</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
  <HSNCODE>${esc(item.hsn || '')}</HSNCODE>
  <GSTRATE>${item.gst || 0}</GSTRATE>
  ${item.tallyGuid ? `<GUID>${esc(item.tallyGuid)}</GUID>` : ''}
</STOCKITEM>`);

    // Extra items from POs not in ItemMaster
    const knownNames = new Set(items.map(i => i.name));
    const extraNames = new Set();
    for (const po of pos) {
      for (const it of (po.items || [])) {
        if (it.name && !knownNames.has(it.name)) extraNames.add(it.name.trim());
      }
    }
    const extraItemFragments = [...extraNames].map(name => `
<STOCKITEM NAME="${esc(name)}" ACTION="Create">
  <NAME>${esc(name)}</NAME><UNITS>Nos</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
</STOCKITEM>`);

    const allStockFragments = [...stockItemFragments, ...extraItemFragments];

    // ── System Ledgers (always in first batch) ───────────────────────────────
    // ACTION="Create" — Tally silently skips these if they already exist.
    // Never send OPENINGBALANCE — it resets the client's balance on a newly created ledger
    // or can interfere with Tally's own GST setup if the ledger is created fresh.
    const systemLedgerFragments = [
      `<LEDGER NAME="Purchase Accounts" ACTION="Create"><NAME>Purchase Accounts</NAME><PARENT>Purchase Accounts</PARENT></LEDGER>`,
      `<LEDGER NAME="Sales Accounts" ACTION="Create"><NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT></LEDGER>`,
      `<LEDGER NAME="CGST" ACTION="Create"><NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="SGST" ACTION="Create"><NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="IGST" ACTION="Create"><NAME>IGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
    ];

    const vendorFragments = vendors.map(v => `
<LEDGER NAME="${esc(v.companyName)}" ACTION="${v.tallyGuid ? 'Alter' : 'Create'}">
  <NAME>${esc(v.companyName)}</NAME>
  <PARENT>Sundry Creditors</PARENT>
  <GSTREGISTRATIONTYPE>${v.gstNumber ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(v.gstNumber || '')}</PARTYGSTIN>
  <EMAIL>${esc(v.email || '')}</EMAIL>
  <LEDGERMOBILE>${esc(v.phone || '')}</LEDGERMOBILE>
  <MAILINGNAME>${esc(v.contactPerson || v.companyName)}</MAILINGNAME>
  ${v.tallyGuid ? `<GUID>${esc(v.tallyGuid)}</GUID>` : ''}
</LEDGER>`);

    const allClients = [
      ...clients.map(c => ({ name: c.name, gst: c.gstNumber, phone: c.phone, email: c.email, guid: c.tallyGuid, openingBalance: c.outstanding || 0 })),
      ...corporateClients.map(c => ({ name: c.name, gst: c.gstNumber, phone: c.phone, email: c.email, guid: c.tallyGuid || c.tallyLedgerId, openingBalance: c.accountsLedger?.openingBalance || 0 })),
    ];
    const clientFragments = allClients.map(c => `
<LEDGER NAME="${esc(c.name)}" ACTION="${c.guid ? 'Alter' : 'Create'}">
  <NAME>${esc(c.name)}</NAME>
  <PARENT>Sundry Debtors</PARENT>
  <GSTREGISTRATIONTYPE>${c.gst ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(c.gst || '')}</PARTYGSTIN>
  <EMAIL>${esc(c.email || '')}</EMAIL>
  <LEDGERMOBILE>${esc(c.phone || '')}</LEDGERMOBILE>
  ${c.guid ? `<GUID>${esc(c.guid)}</GUID>` : ''}
</LEDGER>`);

    const tallyParent = (g) => {
      const s = (g||'').toLowerCase();
      if (s.includes('creditor')) return 'Sundry Creditors';
      if (s.includes('debtor'))   return 'Sundry Debtors';
      if (s.includes('bank'))     return 'Bank Accounts';
      if (s.includes('cash'))     return 'Cash-in-Hand';
      if (s.includes('expense'))  return 'Indirect Expenses';
      if (s.includes('income'))   return 'Indirect Incomes';
      return 'Sundry Debtors';
    };
    const acctLedgerFragments = ledgers.map(l => `
<LEDGER NAME="${esc(l.ledgerName)}" ACTION="${l.tallyGuid ? 'Alter' : 'Create'}">
  <NAME>${esc(l.ledgerName)}</NAME>
  <PARENT>${esc(tallyParent(l.ledgerGroup))}</PARENT>
  <GSTREGISTRATIONTYPE>${l.gstNumber ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(l.gstNumber || '')}</PARTYGSTIN>
  ${l.tallyGuid ? `<GUID>${esc(l.tallyGuid)}</GUID>` : ''}
</LEDGER>`);

    // ── Build batches ────────────────────────────────────────────────────────
    // Batch 1: system ledgers + first N stock items (system ledgers are tiny, always first)
    // Subsequent batches: remaining items, then vendors, clients, account ledgers
    const allLedgerFragments = [
      ...systemLedgerFragments,
      ...vendorFragments,
      ...clientFragments,
      ...acctLedgerFragments,
    ];

    const batches = [
      ...chunkArray(allStockFragments, MASTER_BATCH_SIZE),
      ...chunkArray(allLedgerFragments, MASTER_BATCH_SIZE),
    ].filter(b => b.length > 0);

    LOG(`Masters split into ${batches.length} batches (items:${allStockFragments.length} ledgers:${allLedgerFragments.length})`);

    // ── Send each batch sequentially ─────────────────────────────────────────
    let totalCreated = 0, totalAltered = 0;
    const errors = [];

    for (let i = 0; i < batches.length; i++) {
      const batchXml = wrapMastersXml(cfg, batches[i].join(''));
      LOG(`Sending batch ${i + 1}/${batches.length} (${batches[i].length} records, ${batchXml.length} bytes)`);
      try {
        const resp   = await postXmlWithRetry(cfg, batchXml, MASTER_TIMEOUT_MS, 2);
        const result = parseTallyResponse(resp, `Masters batch ${i + 1}/${batches.length}`);
        totalCreated += result.created || 0;
        totalAltered += result.altered || 0;
        if (!result.ok && result.error) errors.push(`Batch ${i + 1}: ${result.error}`);
      } catch (batchErr) {
        ERR(`Masters batch ${i + 1} failed: ${batchErr.message}`);
        errors.push(`Batch ${i + 1}: ${batchErr.message}`);
      }
    }

    const records  = items.length + vendors.length + allClients.length + ledgers.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    const ok       = errors.length === 0;

    await writeLog({ syncId, type:'Item Master', direction:'ERP → Tally', status: ok ? 'Success' : 'Failed', duration, error: errors.join('; '), records, triggeredBy });
    if (ok) {
      await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
      await AccountsLedger.updateMany({ isActive:true }, { syncedWithTally:true, lastTallySync:new Date() });
      LOG(`Masters synced OK — ${records} records in ${duration} (created:${totalCreated} altered:${totalAltered})`);
    } else {
      LOG(`Masters sync partial — ${errors.length} batch(es) failed in ${duration}`);
    }
    return { ok, records, error: errors.length ? errors.join('; ') : undefined };

  } catch (err) {
    ERR('pushMastersToTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Item Master', direction:'ERP → Tally', status:'Failed', duration, error:err.message, records:0, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

export const pushItemsToTally   = (cfg, t) => pushMastersToTally(cfg, t);
export const pushLedgersToTally = (cfg, t) => pushMastersToTally(cfg, t);

// ─── PUSH: PURCHASE VOUCHERS (POs) ───────────────────────────────────────────

export async function pushPurchaseVouchersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PUR-${Date.now()}`;
  LOG('=== pushPurchaseVouchersToTally START ===');
  try {
    // Only push POs not yet synced that were created in the ERP (not imported from Tally)
    const pos = await PurchaseOrder.find({
      status: { $in:['Approved','Received'] },
      dataSource: { $ne: 'Tally' },
    }).populate('vendor').lean();

    if (!pos.length) {
      await writeLog({ syncId, type:'Purchase', direction:'ERP → Tally', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }

    // ── Step 1: Fetch existing Tally vouchers indexed by PO Number ──────────
    // This lets us decide Create vs Alter per voucher, regardless of tallySync flag.
    const { byPO: tallyPOMap, byVchNo: tallyVchMap } = await fetchTallyPOMap(cfg);
    LOG(`pushPurchaseVouchersToTally: ${pos.length} POs to process, byPO=${tallyPOMap.size} byVchNo=${tallyVchMap.size}`);

    const today = tallyDate(new Date());
    const vouchersXml = pos.map(po => {
      const vendorName = po.vendor?.companyName || 'Unknown Vendor';
      const date       = tallyDate(po.createdAt) || tallyDate(po.orderDate) || today;
      const itemsTotal = (po.items||[]).reduce((s,it)=>s+(it.qty||1)*(it.basePrice||0),0);
      const gstAmt     = +(po.gstTotal||0).toFixed(2);
      const grandTot   = +(po.grandTotal||itemsTotal+gstAmt).toFixed(2);
      const cgstAmt    = +(gstAmt/2).toFixed(2);
      const sgstAmt    = +(gstAmt-cgstAmt).toFixed(2);

      // ── Step 2: Match by PO Number — po.poId is the PO Number ────────────
      // Primary: BuyersOrderNo match. Fallback: VoucherNumber match (for older pushes).
      const poNumber   = (po.poId || '').toUpperCase().trim();
      const existing   = (poNumber ? tallyPOMap.get(poNumber) : null)
                      || (poNumber ? tallyVchMap.get(poNumber) : null);
      const action     = existing ? 'Alter' : 'Create';
      const guidTag    = existing ? `<GUID>${esc(existing.guid)}</GUID>` : '';
      LOG(`PO ${po.poId}: action=${action}${existing ? ` (Tally GUID: ${existing.guid})` : ' (new)'}`);

      const itemsXml = (po.items||[]).map(item => {
        const qty   = item.qty||item.quantity||1;
        const rate  = item.basePrice||item.unitPrice||item.rate||0;
        const total = +(qty*rate).toFixed(2);
        return `
<ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>${esc(item.name||'Unknown Item')}</STOCKITEMNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
  <RATE>${rate}/Nos</RATE><AMOUNT>-${total}</AMOUNT>
  <ACTUALQTY>${qty} Nos</ACTUALQTY><BILLEDQTY>${qty} Nos</BILLEDQTY>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>Purchase Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${total}</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`;
      }).join('');

      return `
<VOUCHER VCHTYPE="Purchase" ACTION="${action}">
  ${guidTag}
  <DATE>${date}</DATE>
  <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(po.poId)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(vendorName)}</PARTYLEDGERNAME>
  <BUYERSORDERNO>${esc(po.poId)}</BUYERSORDERNO>
  <NARRATION>PO: ${esc(po.poId)}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(vendorName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${grandTot}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${cgstAmt>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${cgstAmt}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${sgstAmt>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${sgstAmt}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${itemsXml}
</VOUCHER>`;
    }).join('');

    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${vouchersXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

    const resp    = await postXmlWithRetry(cfg, xml, 30000);
    const result  = parseTallyResponse(resp, 'Purchase Vouchers');
    const records = pos.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Purchase', direction:'ERP → Tally', status:result.ok?'Success':'Failed', duration, error:result.error, records, triggeredBy });
    if (result.ok) {
      await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
      await PurchaseOrder.updateMany({ _id:{$in:pos.map(p=>p._id)} }, { tallySync:true, tallySyncAt:new Date() });
    }
    return { ok:result.ok, records, error:result.error };
  } catch (err) {
    ERR('pushPurchaseVouchersToTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Purchase', direction:'ERP → Tally', status:'Failed', duration, error:err.message, records:0, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PUSH: SALES (INVOICE) VOUCHERS ──────────────────────────────────────────

export async function pushSalesVouchersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-SALES-${Date.now()}`;
  LOG('=== pushSalesVouchersToTally START ===');
  try {
    // Export all ERP-created invoices that haven't been synced yet.
    // Status filter is intentionally broad — 'Draft' is the default for Excel-uploaded
    // invoices from /finance/invoices/single. We must not block those from export.
    // Only skip: Cancelled (invalid) and Tally-origin invoices.
    const invoices = await Invoice.find({
      status: { $nin: ['Cancelled'] },
      source: { $nin: ['Tally', 'tally'] },
    }).lean();

    if (!invoices.length) {
      await writeLog({ syncId, type:'Sales', direction:'ERP → Tally', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }

    LOG(`pushSalesVouchersToTally: exporting ${invoices.length} invoices`);
    LOG(`First invoice: no=${invoices[0].invoiceNo} source=${invoices[0].source} tallySync=${invoices[0].tallySync} tallyGuid=${invoices[0].tallyGuid || 'none'}`);

    // ── Step 1: Fetch existing Tally vouchers indexed by PO Number ──────────
    // Determines whether to Create (new PO) or Alter (existing PO) each voucher.
    const { byPO: tallyPOMap, byVchNo: tallyVchMap } = await fetchTallyPOMap(cfg);
    LOG(`pushSalesVouchersToTally: ${invoices.length} invoices to process, byPO=${tallyPOMap.size} byVchNo=${tallyVchMap.size}`);

    const vouchersXml = invoices.map((inv, idx) => {
      const cgst = (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0);
      const sgst = (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0);
      const igst = (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0);
      const itemsXml = (inv.items||[]).map(item => `
<ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>${esc(item.description||item.name||'Item')}</STOCKITEMNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
  <RATE>${item.rate||item.unitPrice||0}/Nos</RATE>
  <AMOUNT>-${item.amount||item.total||0}</AMOUNT>
  <ACTUALQTY>${item.qty||item.quantity||0} Nos</ACTUALQTY>
  <BILLEDQTY>${item.qty||item.quantity||0} Nos</BILLEDQTY>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${item.amount||item.total||0}</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`).join('');

      // ── Step 2: Match by PO Number (buyersOrderNo), fallback to VoucherNumber ─
      // Priority 1: BuyersOrderNo match — the primary key going forward.
      // Priority 2: VoucherNumber match — catches vouchers pushed before BuyersOrderNo was added.
      // Neither found → Create new.
      const poNumber = (inv.buyersOrderNo || '').toUpperCase().trim();
      const vchKey   = (inv.invoiceNo     || '').toUpperCase().trim();
      const existing = (poNumber ? tallyPOMap.get(poNumber) : null)
                    || (vchKey   ? tallyVchMap.get(vchKey)  : null);
      const action   = existing ? 'Alter' : 'Create';
      const guidTag  = existing ? `<GUID>${esc(existing.guid)}</GUID>` : '';
      LOG(`Invoice ${inv.invoiceNo} (PO: ${poNumber||'none'}): action=${action}${existing ? ` (Tally GUID: ${existing.guid})` : ' (new)'}`);

      const vXml = `
<VOUCHER VCHTYPE="Sales" ACTION="${action}">
  ${guidTag}
  <DATE>${tallyDate(inv.invoiceDate)||tallyDate(new Date())}</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(inv.invoiceNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(inv.partyName)}</PARTYLEDGERNAME>
  <BUYERSORDERNO>${esc(inv.buyersOrderNo||'')}</BUYERSORDERNO>
  <NARRATION>ERP Invoice: ${esc(inv.invoiceNo)}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(inv.partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${inv.grandTotal||0}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${cgst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${cgst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${sgst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${sgst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${igst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>IGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${igst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${itemsXml}
</VOUCHER>`;

      if (idx === 0) LOG(`pushSalesVouchersToTally: FIRST INVOICE XML:\n${vXml}`);
      return vXml;
    }).join('');

    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${vouchersXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

    const resp    = await postXmlWithRetry(cfg, xml, 30000);
    const result  = parseTallyResponse(resp, 'Sales Vouchers');
    const records = invoices.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Sales', direction:'ERP → Tally', status:result.ok?'Success':'Failed', duration, error:result.error, records, triggeredBy });
    if (result.ok) {
      await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
      await Invoice.updateMany({ _id:{$in:invoices.map(i=>i._id)} }, { tallySync:true, tallySyncAt:new Date() });
    }
    return { ok:result.ok, records, error:result.error };
  } catch (err) {
    ERR('pushSalesVouchersToTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Sales', direction:'ERP → Tally', status:'Failed', duration, error:err.message, records:0, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PUSH: PAYMENT VOUCHERS (ERP → Tally) ───────────────────────────────────
// Pushes TallyVoucher records of type 'Payment' that were created in ERP.

export async function pushPaymentVouchersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PAY-${Date.now()}`;
  LOG('=== pushPaymentVouchersToTally START ===');
  try {
    const payments = await TallyVoucher.find({
      voucherType: 'Payment', source: 'ERP', tallyGuid: { $exists:false },
    }).lean();

    if (!payments.length) {
      await writeLog({ syncId, type:'Payment', direction:'ERP → Tally', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }

    const vouchersXml = payments.map(pmt => {
      const date = tallyDate(pmt.voucherDate) || tallyDate(new Date());
      const ledgersXml = (pmt.ledgerEntries||[]).map(e => `
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>
  <ISDEEMEDPOSITIVE>${e.isDeemed ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
  <AMOUNT>${e.isDeemed ? '' : '-'}${Math.abs(e.amount||0)}</AMOUNT>
</ALLLEDGERENTRIES.LIST>`).join('');

      return `
<VOUCHER VCHTYPE="Payment" ACTION="Create">
  <DATE>${date}</DATE>
  <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(pmt.voucherNumber||'')}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(pmt.partyName||'')}</PARTYLEDGERNAME>
  <NARRATION>${esc(pmt.narration||'Payment')}</NARRATION>
  ${ledgersXml}
</VOUCHER>`;
    }).join('');

    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${vouchersXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

    const resp    = await postXmlWithRetry(cfg, xml, 25000);
    const result  = parseTallyResponse(resp, 'Payment Vouchers');
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Payment', direction:'ERP → Tally', status:result.ok?'Success':'Failed', duration, error:result.error, records:payments.length, triggeredBy });
    return { ok:result.ok, records:payments.length, error:result.error };
  } catch (err) {
    ERR('pushPaymentVouchersToTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Payment', direction:'ERP → Tally', status:'Failed', duration, error:err.message, records:0, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PUSH: RECEIPT VOUCHERS (ERP → Tally) ────────────────────────────────────

export async function pushReceiptVouchersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-REC-${Date.now()}`;
  LOG('=== pushReceiptVouchersToTally START ===');
  try {
    const receipts = await TallyVoucher.find({
      voucherType: 'Receipt', source: 'ERP', tallyGuid: { $exists:false },
    }).lean();

    if (!receipts.length) {
      await writeLog({ syncId, type:'Receipt', direction:'ERP → Tally', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }

    const vouchersXml = receipts.map(rec => {
      const date = tallyDate(rec.voucherDate) || tallyDate(new Date());
      const ledgersXml = (rec.ledgerEntries||[]).map(e => `
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>
  <ISDEEMEDPOSITIVE>${e.isDeemed ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
  <AMOUNT>${e.isDeemed ? '' : '-'}${Math.abs(e.amount||0)}</AMOUNT>
</ALLLEDGERENTRIES.LIST>`).join('');
      return `
<VOUCHER VCHTYPE="Receipt" ACTION="Create">
  <DATE>${date}</DATE>
  <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(rec.voucherNumber||'')}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(rec.partyName||'')}</PARTYLEDGERNAME>
  <NARRATION>${esc(rec.narration||'Receipt')}</NARRATION>
  ${ledgersXml}
</VOUCHER>`;
    }).join('');

    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${vouchersXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

    const resp    = await postXmlWithRetry(cfg, xml, 25000);
    const result  = parseTallyResponse(resp, 'Receipt Vouchers');
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Receipt', direction:'ERP → Tally', status:result.ok?'Success':'Failed', duration, error:result.error, records:receipts.length, triggeredBy });
    return { ok:result.ok, records:receipts.length, error:result.error };
  } catch (err) {
    ERR('pushReceiptVouchersToTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Receipt', direction:'ERP → Tally', status:'Failed', duration, error:err.message, records:0, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PULL: STOCK ITEMS (Tally → ERP) ─────────────────────────────────────────
// Stores GUID to prevent duplicates on future syncs.

export async function pullItemsFromTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PULL-ITEMS-${Date.now()}`;
  LOG('=== pullItemsFromTally START ===');
  try {
    // Helper to build dynamic TDL collection XML (uses type, no hardcoded names)
    const buildDynamicCollectionXml = (tallyType, collectionName) => {
      const company = (cfg.companyName || '').trim();
      const companyTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
      return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>${collectionName}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${companyTag}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="${collectionName}">
            <TYPE>${tallyType}</TYPE>
            <FETCH>*</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
    };
    // Use dynamic TDL collection first, avoid hardcoded report names
    let resp = await postXmlWithRetry(cfg, buildDynamicCollectionXml('StockItem', 'DynamicInventory'), 60000);
    if (!resp || !resp.includes('<STOCKITEM')) {
      LOG('Dynamic TDL failed, trying fallback dynamic collection...');
      resp = await postXmlWithRetry(cfg, buildDynamicCollectionXml('StockItem', 'StockItems'), 60000);
    }
    if (!resp || !resp.includes('<STOCKITEM')) {
      await writeLog({ syncId, type:'Item Master', direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const matches = [...resp.matchAll(/<STOCKITEM([^>]*)>([\s\S]*?)<\/STOCKITEM>/gi)];
    const ops = [];
    for (const m of matches) {
      const attrs = m[1];
      const block = m[2];
      
      // Extract name from various places
      let name = '';
      const nameAttrMatch = attrs.match(/NAME="([^"]*)"/i);
      if (nameAttrMatch) name = nameAttrMatch[1].trim();
      
      if (!name) {
        // Try LANGUAGENAME.LIST -> NAME.LIST -> NAME
        const langNameMatch = block.match(/<LANGUAGENAME\.LIST>[\s\S]*?<NAME\.LIST[\s\S]*?<NAME>([\s\S]*?)<\/NAME>/i);
        if (langNameMatch) name = langNameMatch[1].trim();
      }
      
      if (!name) continue;
      
      const guid = extractGuid(block);
      const alterId = extractAlterId(block);
      const hsn     = (block.match(/<HSNCODE>(.*?)<\/HSNCODE>/i)?.[1]||'').trim();
      const gst     = parseFloat(block.match(/<GSTRATE>(.*?)<\/GSTRATE>/i)?.[1])||0;
      const unit    = (block.match(/<BASEUNITS>(.*?)<\/BASEUNITS>/i)?.[1]||'Nos').trim();
      const cost    = parseFloat(block.match(/<STANDARDCOST>(.*?)<\/STANDARDCOST>/i)?.[1])||0;
      const uMap = {Nos:'units',Kg:'kg',Ltr:'liter',Mtr:'meter',Box:'box',Pcs:'piece'};
      const cleanGuid = guid ? guid.replace(/[^A-Z0-9]/gi, '') : null;
      const sku = cleanGuid ? `TALLY-${cleanGuid}` : name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,30);
      const itemId = cleanGuid ? `TALLY-${cleanGuid}` : `TALLY-${sku}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
      ops.push({ updateOne:{
        filter: guid ? { tallyGuid: guid } : { name },
        update:{
          $set:{ itemId, sku, hsn, gst, unit:uMap[unit]||'units', costPrice:cost, unitPrice:cost,
                 tallySynced:true, lastTallySync:new Date(),
                 dataSource:'Tally',  // mark as imported from Tally — never export back
                 ...(guid ? { tallyGuid:guid } : {}),
                 ...(alterId ? { tallyAlterId:alterId } : {}) },
          $setOnInsert:{ name, sellingPrice:cost, isActive:true },
        },
        upsert:true,
      }});
    }
    if (ops.length) await ItemMaster.bulkWrite(ops, { ordered:false });
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Item Master', direction:'Tally → ERP', status:'Success', duration, records:ops.length, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
    LOG(`Pulled ${ops.length} items in ${duration}`);
    return { ok:true, records:ops.length };
  } catch (err) {
    ERR('pullItemsFromTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Item Master', direction:'Tally → ERP', status:'Failed', duration, error:err.message, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PULL: LEDGERS (Tally → ERP) ─────────────────────────────────────────────
// Upserts Vendors from Sundry Creditors and Clients from Sundry Debtors using GUID.

export async function pullLedgersFromTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PULL-LEDGER-${Date.now()}`;
  LOG('=== pullLedgersFromTally START ===');
  try {
    // Helper to build dynamic TDL collection XML (uses type, no hardcoded names)
    const buildDynamicCollectionXml = (tallyType, collectionName) => {
      const company = (cfg.companyName || '').trim();
      const companyTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
      return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>${collectionName}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${companyTag}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="${collectionName}">
            <TYPE>${tallyType}</TYPE>
            <FETCH>*</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
    };
    // Use dynamic TDL collection first, avoid hardcoded report names
    let resp = await postXmlWithRetry(cfg, buildDynamicCollectionXml('Ledger', 'DynamicLedger'), 60000);
    if (!resp || !resp.includes('<LEDGER')) {
      LOG('Dynamic TDL failed, trying fallback dynamic collection...');
      resp = await postXmlWithRetry(cfg, buildDynamicCollectionXml('Ledger', 'Ledgers'), 60000);
    }
    if (!resp || !resp.includes('<LEDGER')) {
      await writeLog({ syncId, type:'Ledger', direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const matches = [...resp.matchAll(/<LEDGER([^>]*)>([\s\S]*?)<\/LEDGER>/gi)];
    const ledgerOps = [], vendorOps = [], clientOps = [];

    for (const m of matches) {
      const attrs = m[1];
      const block = m[2] || '';
      
      // Extract name from various places
      let name = '';
      const nameAttrMatch = attrs.match(/NAME="([^"]*)"/i);
      if (nameAttrMatch) name = nameAttrMatch[1].trim();
      
      if (!name) {
        // Try LANGUAGENAME.LIST -> NAME.LIST -> NAME
        const langNameMatch = block.match(/<LANGUAGENAME\.LIST>[\s\S]*?<NAME\.LIST[\s\S]*?<NAME>([\s\S]*?)<\/NAME>/i);
        if (langNameMatch) name = langNameMatch[1].trim();
      }
      if (!name) {
        // Try LEDGSTNAME
        const gstNameMatch = block.match(/<LEDGSTNAME>([\s\S]*?)<\/LEDGSTNAME>/i);
        if (gstNameMatch) name = gstNameMatch[1].trim();
      }
      if (!name) {
        // Try MAILINGNAME
        const mailingNameMatch = block.match(/<MAILINGNAME>([\s\S]*?)<\/MAILINGNAME>/i);
        if (mailingNameMatch) name = mailingNameMatch[1].trim();
      }
      
      if (!name) continue;
      
      const guid = extractGuid(block);
      if (!guid) {
        LOG('Skipping ledger without GUID:', name);
        continue;
      }
      const alterId = extractAlterId(block);
      const parent = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1]||'').trim();
      if (!parent.toLowerCase().includes('sundry')) continue;

      const gstNumber      = (block.match(/<PARTYGSTIN>(.*?)<\/PARTYGSTIN>/i)?.[1]||'N/A').trim();
      const openingBalance = parseFloat(block.match(/<OPENINGBALANCE>(.*?)<\/OPENINGBALANCE>/i)?.[1])||0;
      const email          = (block.match(/<EMAIL>(.*?)<\/EMAIL>/i)?.[1]||'').trim();
      const phone          = (block.match(/<LEDGERMOBILE>(.*?)<\/LEDGERMOBILE>/i)?.[1]||'').trim();
      const isCreditor     = parent.toLowerCase().includes('creditor');
      const ledgerGroup    = isCreditor ? 'Sundry Creditors' : 'Sundry Debtors';
      const ledgerCode     = `TALLY-${guid.replace(/[^A-Z0-9]/gi, '')}`;

      // Upsert AccountsLedger (primary record)
      const ledgerFilter = { tallyGuid: guid };
      ledgerOps.push({ updateOne:{
        filter: ledgerFilter,
        update:{
          $set:{ tallyGuid: guid, tallyAlterId: alterId, ledgerGroup, gstNumber, openingBalance, email, phone,
                 syncedWithTally:true, lastTallySync:new Date(),
                 dataSource:'Tally' },  // mark as imported from Tally — never export back
          $setOnInsert:{ ledgerCode, ledgerName:name, contactPerson:name, panNumber:'N/A', isActive:true },
        },
        upsert:true,
      }});

      // Also upsert Vendor or Client model for full ERP integration
      if (isCreditor) {
        const vFilter = { tallyGuid: guid };
        const safeEmail = email || `${name.replace(/\s+/g,'').toLowerCase()}@tally.sync`;
        vendorOps.push({ updateOne:{
          filter: vFilter,
          update:{
            $set:{ 
              tallyGuid: guid,
              tallyAlterId: alterId,
              email: safeEmail, 
              phone: phone || '0000000000', 
              gstNumber: gstNumber || 'N/A',
              address: 'Imported from Tally',
              contactPerson: name,
              tallySynced:true, lastTallySync:new Date(),
              dataSource:'Tally'  // mark as imported from Tally — never export back
            },
            $setOnInsert:{
              vendorId: `VND-TALLY-${guid.replace(/[^A-Z0-9]/gi, '')}`,
              companyName: name,
              category:'General',
              status:'Active',
            },
          },
          upsert:true,
        }});
      } else {
        const cFilter = { tallyGuid: guid };
        const safeEmail = email || `${name.replace(/\s+/g,'').toLowerCase()}@tally.sync`;
        clientOps.push({ updateOne:{
          filter: cFilter,
          update:{
            $set:{ 
              tallyGuid: guid,
              tallyAlterId: alterId,
              email: safeEmail, 
              phone: phone || '0000000000', 
              gstNumber: gstNumber || 'N/A',
              address: 'Imported from Tally',
              contact: name,
              tallySynced:true, lastTallySync:new Date(),
              dataSource:'Tally'  // mark as imported from Tally — never export back
            },
            $setOnInsert:{
              clientId: `CLT-TALLY-${guid.replace(/[^A-Z0-9]/gi, '')}`,
              name,
              category:'Trading',
              status:'Active',
            },
          },
          upsert:true,
        }});
      }
    }

    const [lr, vr, cr] = await Promise.all([
      ledgerOps.length ? AccountsLedger.bulkWrite(ledgerOps, { ordered:false }) : Promise.resolve(null),
      vendorOps.length ? Vendor.bulkWrite(vendorOps, { ordered:false }) : Promise.resolve(null),
      clientOps.length ? Client.bulkWrite(clientOps, { ordered:false }) : Promise.resolve(null),
    ]);
    const records = ledgerOps.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Ledger', direction:'Tally → ERP', status:'Success', duration, records, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
    LOG(`Pulled ${records} ledgers (${vendorOps.length} vendors, ${clientOps.length} clients) in ${duration}`);
    return { ok:true, records };
  } catch (err) {
    ERR('pullLedgersFromTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Ledger', direction:'Tally → ERP', status:'Failed', duration, error:err.message, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PULL: VOUCHERS (Sales/Purchase) from Tally ───────────────────────────────

export async function pullVouchersFromTally(cfg, voucherType, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PULL-${voucherType.toUpperCase()}-${Date.now()}`;
  const logType = voucherType === 'Purchase' ? 'Purchase' : 'Sales';
  LOG(`=== pullVouchersFromTally (${voucherType}) START ===`);
  try {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME>
${exportVars(`<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><VOUCHERTYPENAME>${voucherType}</VOUCHERTYPENAME>`)}</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const resp = await postXmlWithRetry(cfg, xml, 30000);
    if (!resp || !resp.includes('<VOUCHER') || resp.includes('<TALLYREQUEST>Import Data')) {
      await writeLog({ syncId, type:logType, direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const vMatches = [...resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
    const ops = [];
    for (const m of vMatches) {
      const block      = m[1];
      const guid       = extractGuid(block);
      if (!guid) continue;
      const alterId    = extractAlterId(block);
      const invoiceNo  = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim();
      const partyName  = (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1]||'Unknown').trim();
      const rawDate    = (block.match(/<DATE>(.*?)<\/DATE>/i)?.[1]||'').trim();
      const grandTotal = Math.abs(parseFloat(block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0);
      const invDate    = rawDate.length===8 ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`) : new Date();
      ops.push({ updateOne:{
        filter: { tallyGuid: guid },
        update:{
          $set:{ tallyGuid: guid, tallyAlterId: alterId, partyName, grandTotal, source:'Tally' },
          $setOnInsert:{ invoiceNo, partyName, invoiceDate:invDate, grandTotal, source:'Tally', status:'Sent', invoiceType:'single', items:[] },
        },
        upsert:true,
      }});
    }
    if (ops.length) await Invoice.bulkWrite(ops, { ordered:false });
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:logType, direction:'Tally → ERP', status:'Success', duration, records:ops.length, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
    return { ok:true, records:ops.length };
  } catch (err) {
    ERR(`pullVouchersFromTally(${voucherType}):`, err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:logType, direction:'Tally → ERP', status:'Failed', duration, error:err.message, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PULL: PAYMENT & RECEIPT VOUCHERS (Tally → ERP) ─────────────────────────
// Stores into TallyVoucher model with GUID deduplication.

export async function pullPaymentReceiptFromTally(cfg, voucherType, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PULL-${voucherType.toUpperCase()}-${Date.now()}`;
  LOG(`=== pullPaymentReceiptFromTally (${voucherType}) START ===`);
  try {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME>
${exportVars(`<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><VOUCHERTYPENAME>${voucherType}</VOUCHERTYPENAME>`)}</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const resp = await postXmlWithRetry(cfg, xml, 30000);
    if (!resp || !resp.includes('<VOUCHER')) {
      await writeLog({ syncId, type:voucherType, direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const vMatches = [...resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
    const ops = [];
    for (const m of vMatches) {
      const block       = m[1];
      const guid        = extractGuid(block);
      if (!guid) continue;
      const alterId     = extractAlterId(block);
      const voucherNo   = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim();
      const partyName   = (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1]||'').trim();
      const rawDate     = (block.match(/<DATE>(.*?)<\/DATE>/i)?.[1]||'').trim();
      const narration   = (block.match(/<NARRATION>(.*?)<\/NARRATION>/i)?.[1]||'').trim();
      const vDate       = rawDate.length===8 ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`) : new Date();

      // Parse ledger entries
      const ledgerEntries = [];
      for (const le of block.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi)) {
        const lb = le[1];
        const lName   = (lb.match(/<LEDGERNAME>(.*?)<\/LEDGERNAME>/i)?.[1]||'').trim();
        const lAmt    = parseFloat(lb.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0;
        const isDeemed = (lb.match(/<ISDEEMEDPOSITIVE>(.*?)<\/ISDEEMEDPOSITIVE>/i)?.[1]||'No').trim() === 'Yes';
        if (lName) ledgerEntries.push({ ledgerName:lName, amount:lAmt, isDeemed });
      }

      // Parse inventory entries (ALLINVENTORYENTRIES.LIST for Sales/Purchase)
      const inventoryEntries = [];
      const invPat = /<ALLINVENTORYENTRIES\.LIST>([\s\S]*?)<\/ALLINVENTORYENTRIES\.LIST>|<INVENTORYENTRIES\.LIST>([\s\S]*?)<\/INVENTORYENTRIES\.LIST>/gi;
      for (const inv of block.matchAll(invPat)) {
        const ib = inv[1] || inv[2];
        const sn = (ib.match(/<STOCKITEMNAME>(.*?)<\/STOCKITEMNAME>/i)?.[1]||'').trim();
        if (!sn) continue;
        const rawQty  = (ib.match(/<BILLEDQTY>(.*?)<\/BILLEDQTY>/i)?.[1] || ib.match(/<ACTUALQTY>(.*?)<\/ACTUALQTY>/i)?.[1] || '0').trim();
        const rawRate = (ib.match(/<RATE>(.*?)<\/RATE>/i)?.[1]||'0').trim();
        const qty  = parseFloat(rawQty.replace(/[^\d.-]/g,''))  || 0;
        const rate = parseFloat(rawRate.replace(/[^\d.-]/g,'')) || 0;
        const amt  = Math.abs(parseFloat(ib.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0);
        inventoryEntries.push({ stockItemName: sn, qty, rate, amount: amt });
      }

      // Compute amount: items+taxes → max ledger → fallback
      let amount = 0;
      if (inventoryEntries.length > 0) {
        const itemTotal = inventoryEntries.reduce((s,i) => s + i.amount, 0);
        const taxTotal  = ledgerEntries.reduce((s,l) => {
          const n = l.ledgerName.toLowerCase();
          return (n.includes('cgst')||n.includes('sgst')||n.includes('igst')||n.includes('gst')||n.includes('tax')||n.includes('round')) ? s + Math.abs(l.amount) : s;
        }, 0);
        amount = itemTotal + taxTotal;
      } else if (ledgerEntries.length > 0) {
        amount = Math.max(...ledgerEntries.map(l => Math.abs(l.amount)));
        if (!isFinite(amount)) amount = 0;
      }
      if (amount === 0) amount = Math.abs(parseFloat(block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0);

      ops.push({ updateOne:{
        filter: { tallyGuid: guid },
        update:{
          $set:{ tallyGuid: guid, tallyAlterId: alterId, voucherNumber: voucherNo, voucherType, partyName, partyLedgerName: partyName, amount, narration, voucherDate:vDate, ledgerEntries, inventoryEntries, source:'Tally', syncedAt:new Date() },
        },
        upsert:true,
      }});
    }
    if (ops.length) await TallyVoucher.bulkWrite(ops, { ordered:false });
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:voucherType, direction:'Tally → ERP', status:'Success', duration, records:ops.length, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
    LOG(`Pulled ${ops.length} ${voucherType} vouchers in ${duration}`);
    return { ok:true, records:ops.length };
  } catch (err) {
    ERR(`pullPaymentReceiptFromTally(${voucherType}):`, err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:voucherType, direction:'Tally → ERP', status:'Failed', duration, error:err.message, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── ORCHESTRATORS ────────────────────────────────────────────────────────────

function mergeResults(results) {
  const records = results.reduce((s,r)=>s+(r.records||0),0);
  const failed  = results.filter(r=>!r.ok);
  const ok      = failed.length === 0;
  const error   = failed.map(r=>r.error).filter(Boolean).join('; ') || undefined;
  return { ok, records, results, error };
}

/**
 * runFullSync — complete bi-directional sync:
 *   Phase 1 (ERP → Tally): Masters → Purchase Vouchers → Sales Vouchers → Payment → Receipt
 *   Phase 2 (Tally → ERP): Stock Items → Ledgers → Sales Vouchers → Purchase Vouchers → Payments → Receipts
 */
export async function runFullSync(triggeredBy) {
  LOG('========== runFullSync START ==========');
  const cfg   = await getConfig();
  const check = await checkTallyReachable(cfg);
  if (!check.reachable) {
    ERR('Tally not reachable:', check.error);
    await TallyConfig.findOneAndUpdate({},{connectionStatus:'Disconnected'},{sort:{_id:1},upsert:true});
    return { ok:false, offline:true, records:0, error:check.error };
  }
  await TallyConfig.findOneAndUpdate({},{connectionStatus:'Connected'},{sort:{_id:1},upsert:true});

  const direction = cfg.syncDirection || 'Bi-directional';
  const prefs     = cfg.syncPrefs || {};
  const results   = [];

  // ── ERP → Tally ────────────────────────────────────────────────────────────
  if (direction !== 'Tally → ERP') {
    if (prefs.masterData !== false)       results.push(await pushMastersToTally(cfg, triggeredBy));
    if (prefs.purchaseVouchers !== false) results.push(await pushPurchaseVouchersToTally(cfg, triggeredBy));
    if (prefs.salesVouchers !== false)    results.push(await pushSalesVouchersToTally(cfg, triggeredBy));
    if (prefs.paymentVouchers !== false)  results.push(await pushPaymentVouchersToTally(cfg, triggeredBy));
    if (prefs.receiptVouchers !== false)  results.push(await pushReceiptVouchersToTally(cfg, triggeredBy));
  }

  // ── Tally → ERP ────────────────────────────────────────────────────────────
  if (direction !== 'ERP → Tally') {
    if (prefs.masterData !== false) {
      results.push(await pullItemsFromTally(cfg, triggeredBy));
      results.push(await pullLedgersFromTally(cfg, triggeredBy));
    }
    if (prefs.purchaseVouchers !== false) results.push(await pullVouchersFromTally(cfg,'Purchase',triggeredBy));
    if (prefs.salesVouchers !== false)    results.push(await pullVouchersFromTally(cfg,'Sales',triggeredBy));
    if (prefs.paymentVouchers !== false)  results.push(await pullPaymentReceiptFromTally(cfg,'Payment',triggeredBy));
    if (prefs.receiptVouchers !== false)  results.push(await pullPaymentReceiptFromTally(cfg,'Receipt',triggeredBy));
  }

  const totalRecords = results.reduce((s,r)=>s+(r.records||0),0);
  const failed       = results.filter(r=>!r.ok);
  const ok           = failed.length === 0;
  const error        = failed.length > 0 ? failed.map(r=>r.error).filter(Boolean).join('; ') : undefined;
  LOG(`========== runFullSync END — ok:${ok} records:${totalRecords} errors:${error||'none'} ==========`);
  return { ok, records:totalRecords, results, error };
}

/**
 * runTargetedSync — for individual sync buttons / manual triggers
 */
export async function runTargetedSync(type, triggeredBy) {
  LOG(`runTargetedSync type="${type}"`);
  const cfg   = await getConfig();
  const check = await checkTallyReachable(cfg);
  if (!check.reachable) {
    await TallyConfig.findOneAndUpdate({},{connectionStatus:'Disconnected'},{sort:{_id:1},upsert:true});
    return { ok:false, offline:true, records:0, error:check.error };
  }
  await TallyConfig.findOneAndUpdate({},{connectionStatus:'Connected'},{sort:{_id:1},upsert:true});

  const direction = cfg.syncDirection || 'Bi-directional';
  const pushOnly  = direction === 'ERP → Tally';
  const pullOnly  = direction === 'Tally → ERP';

  switch (type) {
    case 'master':
    case 'Item Master':
    case 'Items':
    case 'Ledger':
    case 'Ledgers': {
      const results = [];
      if (!pullOnly) results.push(await pushMastersToTally(cfg, triggeredBy));
      if (!pushOnly) {
        results.push(await pullItemsFromTally(cfg, triggeredBy));
        results.push(await pullLedgersFromTally(cfg, triggeredBy));
      }
      return mergeResults(results);
    }
    case 'transaction':
    case 'Purchase':
    case 'Purchase Vouchers': {
      const results = [];
      if (!pullOnly) {
        results.push(await pushMastersToTally(cfg, triggeredBy));
        results.push(await pushPurchaseVouchersToTally(cfg, triggeredBy));
      }
      if (!pushOnly) results.push(await pullVouchersFromTally(cfg,'Purchase',triggeredBy));
      return mergeResults(results);
    }
    case 'Sales':
    case 'Sales Vouchers': {
      const results = [];
      if (!pullOnly) {
        results.push(await pushMastersToTally(cfg, triggeredBy));
        results.push(await pushSalesVouchersToTally(cfg, triggeredBy));
      }
      if (!pushOnly) results.push(await pullVouchersFromTally(cfg,'Sales',triggeredBy));
      return mergeResults(results);
    }
    case 'Payment':
    case 'Payment Vouchers': {
      const results = [];
      if (!pullOnly) results.push(await pushPaymentVouchersToTally(cfg, triggeredBy));
      if (!pushOnly) results.push(await pullPaymentReceiptFromTally(cfg,'Payment',triggeredBy));
      return mergeResults(results);
    }
    case 'Receipt':
    case 'Receipt Vouchers': {
      const results = [];
      if (!pullOnly) results.push(await pushReceiptVouchersToTally(cfg, triggeredBy));
      if (!pushOnly) results.push(await pullPaymentReceiptFromTally(cfg,'Receipt',triggeredBy));
      return mergeResults(results);
    }
    case 'Full':
    default:
      return runFullSync(triggeredBy);
  }
}
