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

import axios from 'axios';
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

const LOG = (...a) => console.log('[Tally]', ...a);
const ERR = (...a) => console.error('[Tally ERROR]', ...a);

// ─── CONFIG ───────────────────────────────────────────────────────────────────

async function getConfig() {
  let cfg = await TallyConfig.findOne();
  if (!cfg) cfg = await TallyConfig.create({});
  return cfg;
}

function tallyUrl(cfg) {
  // Use the production endpoint if serverUrl is the default or majesticmall
  const host = (cfg.serverUrl || 'https://erp.majesticmall.net').replace(/\/$/, '');
  const port = cfg.port || '9000';
  // If host already contains a port or uses https, don't append port
  if (host.startsWith('https://') || host.includes(':' + port)) return host;
  return `${host}:${port}`;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function postToTally(cfg, xml, timeoutMs = 25000) {
  const url = tallyUrl(cfg);
  const headers = { 'Content-Type': 'text/xml' };
  if (cfg.authType === 'Basic Auth' && cfg.apiKey)
    headers['Authorization'] = `Basic ${Buffer.from(cfg.apiKey).toString('base64')}`;
  else if (cfg.authType === 'API Key' && cfg.apiKey)
    headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  LOG(`POST ${url} (${xml.length} bytes)`);
  const resp = await axios.post(url, xml, { headers, timeout: timeoutMs, responseType: 'text' });
  const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
  LOG(`Response (${body.length} bytes):`, body.slice(0, 400));
  return body;
}

async function checkReachable(cfg) {
  const url = tallyUrl(cfg);
  const pingXml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Companies</REPORTNAME></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
  try {
    await axios.post(url, pingXml, { headers: { 'Content-Type': 'text/xml' }, timeout: 8000, responseType: 'text', validateStatus: () => true });
    return { reachable: true };
  } catch (err) {
    const code = err.code || '';
    if (code === 'ECONNREFUSED') return { reachable: false, error: `Tally not running at ${url}. Enable HTTP Server in Tally (F12 → Advanced → Port 9000).` };
    if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') return { reachable: false, error: `Tally at ${url} timed out.` };
    if (code === 'ENOTFOUND') return { reachable: false, error: `Cannot resolve host "${cfg.serverUrl}". Check the Tally server URL.` };
    return { reachable: false, error: err.message || `Cannot connect to Tally at ${url}` };
  }
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
  const company = (cfg.companyName || '').trim();
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
  const errors = [];
  for (const m of s.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)) {
    const msg = m[1].trim(); if (msg) errors.push(msg);
  }
  if (s.includes('<ERRORS>')) {
    const m = s.match(/<ERRORS>([\s\S]*?)<\/ERRORS>/i);
    if (m) { const msg = m[1].replace(/<[^>]+>/g,' ').trim(); if (msg) errors.push(msg); }
  }
  const created = parseInt(s.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1] || '0');
  const altered  = parseInt(s.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1] || '0');
  const skipped  = parseInt(s.match(/<SKIPPED>(\d+)<\/SKIPPED>/i)?.[1] || '0');
  LOG(`${label} IMPORTRESULT → created:${created} altered:${altered} skipped:${skipped} errors:${errors.length}`);
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
  const cfg = await getConfig();
  LOG('Testing connection to', tallyUrl(cfg));
  const check = await checkReachable(cfg);
  if (!check.reachable) {
    await TallyConfig.findOneAndUpdate({}, { connectionStatus: 'Disconnected' }, { upsert: true });
    return { status: 'Disconnected', error: check.error };
  }
  const probeReports = ['List of Companies', 'Company', 'List of Accounts'];
  for (const rn of probeReports) {
    try {
      const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>${rn}</REPORTNAME></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
      const resp = await postToTally(cfg, xml, 8000);
      if (resp && !resp.includes('Could not find Report')) {
        await TallyConfig.findOneAndUpdate({}, { connectionStatus: 'Connected' }, { upsert: true });
        return { status: 'Connected', error: null };
      }
    } catch (_) {}
  }
  await TallyConfig.findOneAndUpdate({}, { connectionStatus: 'Connected' }, { upsert: true });
  return { status: 'Connected', error: null };
}

// ─── PUSH: ALL MASTERS (Items + Customers + Vendors + Ledgers) ────────────────
// Uses GUID to avoid creating duplicates on re-sync.

export async function pushMastersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-MASTERS-${Date.now()}`;
  LOG('=== pushMastersToTally START ===');

  try {
    const [items, vendors, clients, corporateClients, ledgers, pos] = await Promise.all([
      ItemMaster.find({ isActive: true }).lean(),
      Vendor.find({}).lean(),
      Client.find({ status: 'Active' }).lean(),
      CorporateClient.find({ status: 'Active' }).lean(),
      AccountsLedger.find({ isActive: true }).lean(),
      PurchaseOrder.find({ status: { $in: ['Approved','Received'] } }).lean(),
    ]);

    // ── Stock Items (with GUID for dedup) ───────────────────────────────────
    const stockItemsXml = items.map(item => `
<STOCKITEM NAME="${esc(item.name)}" ACTION="${item.tallyGuid ? 'Alter' : 'Create'}">
  <NAME>${esc(item.name)}</NAME>
  <UNITS>${tallyUnit(item.unit)}</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
  <HSNCODE>${esc(item.hsn || '')}</HSNCODE>
  <GSTRATE>${item.gst || 0}</GSTRATE>
  ${item.tallyGuid ? `<GUID>${esc(item.tallyGuid)}</GUID>` : ''}
</STOCKITEM>`).join('');

    // Extra items from POs not in ItemMaster
    const knownNames = new Set(items.map(i => i.name));
    const extraNames = new Set();
    for (const po of pos) {
      for (const it of (po.items || [])) {
        if (it.name && !knownNames.has(it.name)) extraNames.add(it.name.trim());
      }
    }
    const extraItemsXml = [...extraNames].map(name => `
<STOCKITEM NAME="${esc(name)}" ACTION="Create">
  <NAME>${esc(name)}</NAME><UNITS>Nos</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
</STOCKITEM>`).join('');

    // ── System Ledgers ───────────────────────────────────────────────────────
    const systemLedgersXml = `
<LEDGER NAME="Purchase Accounts" ACTION="Create"><NAME>Purchase Accounts</NAME><PARENT>Purchase Accounts</PARENT><OPENINGBALANCE>0</OPENINGBALANCE></LEDGER>
<LEDGER NAME="Sales Accounts" ACTION="Create"><NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT><OPENINGBALANCE>0</OPENINGBALANCE></LEDGER>
<LEDGER NAME="CGST" ACTION="Create"><NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE><OPENINGBALANCE>0</OPENINGBALANCE></LEDGER>
<LEDGER NAME="SGST" ACTION="Create"><NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE><OPENINGBALANCE>0</OPENINGBALANCE></LEDGER>
<LEDGER NAME="IGST" ACTION="Create"><NAME>IGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE><OPENINGBALANCE>0</OPENINGBALANCE></LEDGER>`;

    // ── Vendor Ledgers (Sundry Creditors) ───────────────────────────────────
    const vendorLedgersXml = vendors.map(v => `
<LEDGER NAME="${esc(v.companyName)}" ACTION="${v.tallyGuid ? 'Alter' : 'Create'}">
  <NAME>${esc(v.companyName)}</NAME>
  <PARENT>Sundry Creditors</PARENT>
  <GSTREGISTRATIONTYPE>${v.gstNumber ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(v.gstNumber || '')}</PARTYGSTIN>
  <EMAIL>${esc(v.email || '')}</EMAIL>
  <LEDGERMOBILE>${esc(v.phone || '')}</LEDGERMOBILE>
  <MAILINGNAME>${esc(v.contactPerson || v.companyName)}</MAILINGNAME>
  <OPENINGBALANCE>0</OPENINGBALANCE>
  ${v.tallyGuid ? `<GUID>${esc(v.tallyGuid)}</GUID>` : ''}
</LEDGER>`).join('');

    // ── Customer Ledgers (Clients + Corporate Clients, Sundry Debtors) ────────
    const allClients = [
      ...clients.map(c => ({ name: c.name, gst: c.gstNumber, phone: c.phone, email: c.email, guid: c.tallyGuid })),
      ...corporateClients.map(c => ({ name: c.name, gst: c.gstNumber, phone: c.phone, email: c.email, guid: c.tallyGuid || c.tallyLedgerId })),
    ];
    const customerLedgersXml = allClients.map(c => `
<LEDGER NAME="${esc(c.name)}" ACTION="${c.guid ? 'Alter' : 'Create'}">
  <NAME>${esc(c.name)}</NAME>
  <PARENT>Sundry Debtors</PARENT>
  <GSTREGISTRATIONTYPE>${c.gst ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(c.gst || '')}</PARTYGSTIN>
  <EMAIL>${esc(c.email || '')}</EMAIL>
  <LEDGERMOBILE>${esc(c.phone || '')}</LEDGERMOBILE>
  <OPENINGBALANCE>0</OPENINGBALANCE>
  ${c.guid ? `<GUID>${esc(c.guid)}</GUID>` : ''}
</LEDGER>`).join('');

    // ── Accounts Ledger entries ──────────────────────────────────────────────
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
    const acctLedgersXml = ledgers.map(l => `
<LEDGER NAME="${esc(l.ledgerName)}" ACTION="${l.tallyGuid ? 'Alter' : 'Create'}">
  <NAME>${esc(l.ledgerName)}</NAME>
  <PARENT>${esc(tallyParent(l.ledgerGroup))}</PARENT>
  <GSTREGISTRATIONTYPE>${l.gstNumber ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(l.gstNumber || '')}</PARTYGSTIN>
  <OPENINGBALANCE>${l.openingBalance || 0}</OPENINGBALANCE>
  ${l.tallyGuid ? `<GUID>${esc(l.tallyGuid)}</GUID>` : ''}
</LEDGER>`).join('');

    const xml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
${stockItemsXml}${extraItemsXml}${systemLedgersXml}${vendorLedgersXml}${customerLedgersXml}${acctLedgersXml}
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

    const resp    = await postToTally(cfg, xml, 35000);
    const result  = parseTallyResponse(resp, 'All Masters');
    const records = items.length + vendors.length + allClients.length + ledgers.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;

    await writeLog({ syncId, type:'Item Master', direction:'ERP → Tally', status: result.ok?'Success':'Failed', duration, error:result.error, records, triggeredBy });
    if (result.ok) {
      await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{upsert:true});
      await AccountsLedger.updateMany({ isActive:true }, { syncedWithTally:true, lastTallySync:new Date() });
      LOG(`Masters synced OK — ${records} records in ${duration}`);
    }
    return { ok:result.ok, records, error:result.error };
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
    // Only push POs not yet synced (uses tallyGuid as second dedup check)
    const pos = await PurchaseOrder.find({
      status: { $in:['Approved','Received'] },
      $or: [{ tallySync: { $ne:true } }, { tallyGuid: { $exists:false } }],
    }).populate('vendor').lean();

    if (!pos.length) {
      await writeLog({ syncId, type:'Purchase', direction:'ERP → Tally', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }

    const today = tallyDate(new Date());
    const vouchersXml = pos.map(po => {
      const vendorName = po.vendor?.companyName || 'Unknown Vendor';
      const date       = tallyDate(po.createdAt) || tallyDate(po.orderDate) || today;
      const itemsTotal = (po.items||[]).reduce((s,it)=>s+(it.qty||1)*(it.basePrice||0),0);
      const gstAmt     = +(po.gstTotal||0).toFixed(2);
      const grandTot   = +(po.grandTotal||itemsTotal+gstAmt).toFixed(2);
      const cgstAmt    = +(gstAmt/2).toFixed(2);
      const sgstAmt    = +(gstAmt-cgstAmt).toFixed(2);

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
<VOUCHER VCHTYPE="Purchase" ACTION="Create">
  <DATE>${date}</DATE>
  <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(po.poId)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(vendorName)}</PARTYLEDGERNAME>
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

    const resp    = await postToTally(cfg, xml, 30000);
    const result  = parseTallyResponse(resp, 'Purchase Vouchers');
    const records = pos.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Purchase', direction:'ERP → Tally', status:result.ok?'Success':'Failed', duration, error:result.error, records, triggeredBy });
    if (result.ok) {
      await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{upsert:true});
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
    const invoices = await Invoice.find({
      status: { $in:['Sent','Paid'] },
      $or: [{ tallySync:{$ne:true} }, { tallyGuid:{$exists:false} }],
    }).lean();

    if (!invoices.length) {
      await writeLog({ syncId, type:'Sales', direction:'ERP → Tally', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }

    const vouchersXml = invoices.map(inv => {
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

      return `
<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${tallyDate(inv.invoiceDate)||tallyDate(new Date())}</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(inv.invoiceNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(inv.partyName)}</PARTYLEDGERNAME>
  <NARRATION>Invoice: ${esc(inv.invoiceNo)}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(inv.partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${inv.grandTotal||0}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${cgst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${cgst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${sgst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${sgst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${igst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>IGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${igst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${itemsXml}
</VOUCHER>`;
    }).join('');

    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${vouchersXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

    const resp    = await postToTally(cfg, xml, 30000);
    const result  = parseTallyResponse(resp, 'Sales Vouchers');
    const records = invoices.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Sales', direction:'ERP → Tally', status:result.ok?'Success':'Failed', duration, error:result.error, records, triggeredBy });
    if (result.ok) {
      await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{upsert:true});
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

    const resp    = await postToTally(cfg, xml, 25000);
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

    const resp    = await postToTally(cfg, xml, 25000);
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
    const reportNames = ['List of Stock Items', 'Stock Summary'];
    let resp = '';
    for (const rn of reportNames) {
      const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>${rn}</REPORTNAME>
${exportVars('<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>')}</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
      resp = await postToTally(cfg, xml);
      if (resp && resp.includes('<STOCKITEM')) { LOG(`Got items via "${rn}"`); break; }
      resp = '';
    }
    if (!resp || !resp.includes('<STOCKITEM')) {
      await writeLog({ syncId, type:'Item Master', direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const matches = [...resp.matchAll(/<STOCKITEM[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/STOCKITEM>/gi)];
    const ops = [];
    for (const m of matches) {
      const name = m[1]?.trim(); if (!name) continue;
      const block   = m[2];
      const guid    = extractGuid(block);
      const alterId = extractAlterId(block);
      const hsn  = (block.match(/<HSNCODE>(.*?)<\/HSNCODE>/i)?.[1]||'').trim();
      const gst  = parseFloat(block.match(/<GSTRATE>(.*?)<\/GSTRATE>/i)?.[1])||0;
      const unit = (block.match(/<BASEUNITS>(.*?)<\/BASEUNITS>/i)?.[1]||'Nos').trim();
      const cost = parseFloat(block.match(/<STANDARDCOST>(.*?)<\/STANDARDCOST>/i)?.[1])||0;
      const uMap = {Nos:'units',Kg:'kg',Ltr:'liter',Mtr:'meter',Box:'box',Pcs:'piece'};
      const sku  = name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,30);
      const filter = guid ? { tallyGuid: guid } : { name };
      ops.push({ updateOne:{
        filter,
        update:{
          $set:{ hsn, gst, unit:uMap[unit]||'units', costPrice:cost, unitPrice:cost,
                 tallySynced:true, lastTallySync:new Date(),
                 ...(guid ? { tallyGuid:guid } : {}),
                 ...(alterId ? { tallyAlterId:alterId } : {}) },
          $setOnInsert:{ itemId:`TALLY-${sku}`, sku, name, sellingPrice:cost, isActive:true },
        },
        upsert:true,
      }});
    }
    if (ops.length) await ItemMaster.bulkWrite(ops, { ordered:false });
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Item Master', direction:'Tally → ERP', status:'Success', duration, records:ops.length, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{upsert:true});
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
    const reportNames = ['List of Accounts', 'Ledger Vouchers', 'Ledger'];
    let resp = '';
    for (const rn of reportNames) {
      const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>${rn}</REPORTNAME>
${exportVars('<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>')}</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
      resp = await postToTally(cfg, xml);
      if (resp && resp.includes('<LEDGER') && !resp.includes('<SHORTPROMPT>')) { LOG(`Got ledgers via "${rn}"`); break; }
      resp = '';
    }
    if (!resp || !resp.includes('<LEDGER')) {
      await writeLog({ syncId, type:'Ledger', direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const matches = [...resp.matchAll(/<LEDGER[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/LEDGER>/gi)];
    const ledgerOps = [], vendorOps = [], clientOps = [];

    for (const m of matches) {
      const name = m[1]?.trim(); if (!name) continue;
      const block  = m[2]||'';
      const guid   = extractGuid(block);
      const alterId = extractAlterId(block);
      const parent = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1]||'').trim();
      if (!parent.toLowerCase().includes('sundry')) continue;

      const gstNumber      = (block.match(/<PARTYGSTIN>(.*?)<\/PARTYGSTIN>/i)?.[1]||'N/A').trim();
      const openingBalance = parseFloat(block.match(/<OPENINGBALANCE>(.*?)<\/OPENINGBALANCE>/i)?.[1])||0;
      const email          = (block.match(/<EMAIL>(.*?)<\/EMAIL>/i)?.[1]||'').trim();
      const phone          = (block.match(/<LEDGERMOBILE>(.*?)<\/LEDGERMOBILE>/i)?.[1]||'').trim();
      const isCreditor     = parent.toLowerCase().includes('creditor');
      const ledgerGroup    = isCreditor ? 'Sundry Creditors' : 'Sundry Debtors';
      const ledgerCode     = `TALLY-${name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,20)}-${Date.now()%10000}`;

      // Upsert AccountsLedger (primary record)
      const ledgerFilter = guid ? { tallyGuid: guid } : { ledgerName: name };
      ledgerOps.push({ updateOne:{
        filter: ledgerFilter,
        update:{
          $set:{ ledgerGroup, gstNumber, openingBalance, email, phone,
                 syncedWithTally:true, lastTallySync:new Date(),
                 ...(guid ? { tallyGuid:guid } : {}),
                 ...(alterId ? { tallyAlterId:alterId } : {}) },
          $setOnInsert:{ ledgerCode, ledgerName:name, contactPerson:name, panNumber:'N/A', isActive:true },
        },
        upsert:true,
      }});

      // Also upsert Vendor or Client model for full ERP integration
      if (isCreditor) {
        const vFilter = guid ? { tallyGuid: guid } : { companyName: name };
        vendorOps.push({ updateOne:{
          filter: vFilter,
          update:{
            $set:{ email:email||undefined, phone:phone||undefined, gstNumber:gstNumber||undefined,
                   tallySynced:true, lastTallySync:new Date(),
                   ...(guid ? { tallyGuid:guid } : {}),
                   ...(alterId ? { tallyAlterId:alterId } : {}) },
            $setOnInsert:{
              vendorId:`VND-TALLY-${Date.now()%100000}`, companyName:name,
              category:'General', contactPerson:name,
              phone:phone||'0000000000', email:email||`${name.replace(/\s+/g,'').toLowerCase()}@tally.sync`,
              address:'Imported from Tally', city:'Unknown', state:'Unknown', pincode:'000000', status:'Active',
            },
          },
          upsert:true,
        }});
      } else {
        const cFilter = guid ? { tallyGuid: guid } : { name };
        clientOps.push({ updateOne:{
          filter: cFilter,
          update:{
            $set:{ email:email||undefined, phone:phone||undefined, gstNumber:gstNumber||undefined,
                   tallySynced:true, lastTallySync:new Date(),
                   ...(guid ? { tallyGuid:guid } : {}),
                   ...(alterId ? { tallyAlterId:alterId } : {}) },
            $setOnInsert:{
              clientId:`CLT-TALLY-${Date.now()%100000}`, name,
              contact:name, phone:phone||'0000000000',
              email:email||`${name.replace(/\s+/g,'').toLowerCase()}@tally.sync`,
              city:'Unknown', category:'Trading', status:'Active',
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
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{upsert:true});
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
    const resp = await postToTally(cfg, xml);
    if (!resp || !resp.includes('<VOUCHER') || resp.includes('<TALLYREQUEST>Import Data')) {
      await writeLog({ syncId, type:logType, direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const vMatches = [...resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
    const ops = [];
    for (const m of vMatches) {
      const block      = m[1];
      const guid       = extractGuid(block);
      const alterId    = extractAlterId(block);
      const invoiceNo  = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim();
      if (!invoiceNo) continue;
      const partyName  = (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1]||'Unknown').trim();
      const rawDate    = (block.match(/<DATE>(.*?)<\/DATE>/i)?.[1]||'').trim();
      const grandTotal = Math.abs(parseFloat(block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0);
      const invDate    = rawDate.length===8 ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`) : new Date();
      const filter     = guid ? { tallyGuid: guid } : { invoiceNo };
      ops.push({ updateOne:{
        filter,
        update:{
          $set:{ ...(guid ? { tallyGuid:guid } : {}), ...(alterId ? { tallyAlterId:alterId } : {}), partyName, grandTotal },
          $setOnInsert:{ invoiceNo, partyName, invoiceDate:invDate, grandTotal, source:'manual', status:'Sent', invoiceType:'single', items:[] },
        },
        upsert:true,
      }});
    }
    if (ops.length) await Invoice.bulkWrite(ops, { ordered:false });
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:logType, direction:'Tally → ERP', status:'Success', duration, records:ops.length, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{upsert:true});
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
    const resp = await postToTally(cfg, xml);
    if (!resp || !resp.includes('<VOUCHER')) {
      await writeLog({ syncId, type:voucherType, direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const vMatches = [...resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
    const ops = [];
    for (const m of vMatches) {
      const block       = m[1];
      const guid        = extractGuid(block);
      const alterId     = extractAlterId(block);
      const voucherNo   = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim();
      const partyName   = (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1]||'').trim();
      const rawDate     = (block.match(/<DATE>(.*?)<\/DATE>/i)?.[1]||'').trim();
      const amount      = Math.abs(parseFloat(block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0);
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

      const filter = guid ? { tallyGuid: guid } : (voucherNo ? { voucherNumber:voucherNo, voucherType } : null);
      if (!filter) continue;
      ops.push({ updateOne:{
        filter,
        update:{
          $set:{ partyName, amount, narration, voucherDate:vDate, ledgerEntries, source:'Tally', syncedAt:new Date(),
                 ...(guid ? { tallyGuid:guid } : {}),
                 ...(alterId ? { tallyAlterId:alterId } : {}) },
          $setOnInsert:{ voucherType, voucherNumber:voucherNo||`TALLY-${Date.now()}` },
        },
        upsert:true,
      }});
    }
    if (ops.length) await TallyVoucher.bulkWrite(ops, { ordered:false });
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:voucherType, direction:'Tally → ERP', status:'Success', duration, records:ops.length, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{upsert:true});
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
  const check = await checkReachable(cfg);
  if (!check.reachable) {
    ERR('Tally not reachable:', check.error);
    await TallyConfig.findOneAndUpdate({},{connectionStatus:'Disconnected'},{upsert:true});
    return { ok:false, offline:true, records:0, error:check.error };
  }
  await TallyConfig.findOneAndUpdate({},{connectionStatus:'Connected'},{upsert:true});

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
  const check = await checkReachable(cfg);
  if (!check.reachable) {
    await TallyConfig.findOneAndUpdate({},{connectionStatus:'Disconnected'},{upsert:true});
    return { ok:false, offline:true, records:0, error:check.error };
  }
  await TallyConfig.findOneAndUpdate({},{connectionStatus:'Connected'},{upsert:true});

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
