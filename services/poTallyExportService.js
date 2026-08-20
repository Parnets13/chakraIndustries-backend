

import fs   from 'fs';
import path from 'path';

import TallyConfig  from '../models/TallyConfig.js';
import TallySyncLog from '../models/TallySyncLog.js';
import POInvoice    from '../models/POInvoice.js';
import { postXmlWithRetry } from './tallyFetchEngine.js';

const LOG = (...a) => console.log('[POTallyExport]', ...a);
const ERR = (...a) => console.error('[POTallyExport ERROR]', ...a);

const MAX_RETRIES = 4;  // matches Sales export

// ─── Robust open-company parser (mirrors tallyExportService.parseOpenCompanyListResponse) ──
// Handles COMPANY tags with NAME attribute OR child <NAME> element.
// The simple /NAME/ regex only works for some Tally responses; this handles all editions.
function parseOpenCompanyListResponse(xmlResponse) {
  if (!xmlResponse || !xmlResponse.trim()) return null;

  // Try all <COMPANY> blocks first
  for (const cm of xmlResponse.matchAll(/<COMPANY[^>]*>([\s\S]*?)<\/COMPANY>/gi)) {
    const fullTag = cm[0];
    const block   = cm[1];

    // 1. NAME attribute: <COMPANY NAME="Sri Chakra...">
    const attrM = fullTag.match(/NAME\s*=\s*["']([^"']+)["']/i);
    if (attrM?.[1]?.trim()) return attrM[1].trim();

    // 2. Child <NAME> element
    const nameM = block.match(/<NAME[^>]*>([\s\S]*?)<\/NAME>/i);
    if (nameM?.[1]?.trim()) return nameM[1].trim();
  }

  // Fallback: first <NAME> tag anywhere in response
  for (const m of xmlResponse.matchAll(/<NAME[^>]*>([\s\S]*?)<\/NAME>/gi)) {
    const n = m[1].trim();
    if (n) return n;
  }
  return null;
}

// ─── XML helpers (kept local — no dependency on tallyExportService) ───────────

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function td(d) {
  const dt = d ? new Date(d) : null;
  if (!dt || isNaN(dt.getTime())) return null;
  const y   = dt.getFullYear();
  const m   = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

const todayStr = () => {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
};

/** Cap a YYYYMMDD date string to Tally periodEnd (if known). */
function capTallyDate(date, periodEnd) {
  if (!periodEnd || !date) return date || todayStr();
  return date > periodEnd ? periodEnd : date;
}

const UNIT_MAP = {
  kg: 'Kg', kgs: 'Kg', kilogram: 'Kg',
  liter: 'Ltr', litre: 'Ltr', ltr: 'Ltr',
  meter: 'Mtr', metre: 'Mtr', mtr: 'Mtr',
  box: 'Box', boxes: 'Box',
  piece: 'Pcs', pieces: 'Pcs', pcs: 'Pcs', pc: 'Pcs',
  nos: 'Nos', no: 'Nos', number: 'Nos', units: 'Nos', unit: 'Nos',
  pack: 'Nos', set: 'Nos', gm: 'Gm', gram: 'Gm', grams: 'Gm', ml: 'Ml',
};
const tallyUnit = (u) => UNIT_MAP[(u || '').toLowerCase().trim()] || 'Nos';

function staticVars(cfg, extra = '') {
  const co = (cfg.companyName || '').trim().toUpperCase();
  return `<STATICVARIABLES>${co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : ''}${extra}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>`;
}

function importEnvelope(cfg, reportName, innerXml) {
  return `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>${reportName}</REPORTNAME>
    ${staticVars(cfg)}
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
${innerXml}
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;
}

function importDebugEnvelope(cfg, reportName, innerXml) {
  return `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>${reportName}</REPORTNAME>
    ${staticVars(cfg, '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>')}
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
${innerXml}
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;
}

// ─── HTTP with file logging (mirrors tallyExportService.postXml) ──────────────

async function postXml(cfg, xml, timeoutMs = 40000) {
  const effectiveTimeout = (cfg.useConnector && cfg.connectorId)
    ? Math.max(timeoutMs * 3, 180000)
    : timeoutMs;

  try {
    const ts      = new Date().toISOString().replace(/[:.]/g, '-');
    const logsDir = path.join(process.cwd(), 'logs', 'tally-xml-requests');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, `po-request-${ts}.xml`), xml, 'utf8');
  } catch (_) {}

  LOG(`postXml → ${xml.length} bytes, timeout ${effectiveTimeout}ms`);
  console.log('[POTallyExport] FINAL REQUEST XML:\n' + xml);

  const body = await postXmlWithRetry(cfg, xml, effectiveTimeout);

  try {
    const ts     = new Date().toISOString().replace(/[:.]/g, '-');
    const resDir = path.join(process.cwd(), 'logs', 'tally-xml-responses');
    if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true });
    fs.writeFileSync(path.join(resDir, `po-response-${ts}.xml`), String(body || ''), 'utf8');
  } catch (_) {}

  return body;
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseResponse(xml, label = '') {
  if (!xml || !xml.trim()) return { ok: false, error: 'Empty response from Tally', exceptions: 0, diagnosticsFound: false };
  const s = String(xml);

  LOG(`${label} RAW (${s.length} chars):\n${s.slice(0, 600)}`);

  const errors = [];
  for (const m of s.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi))   { const t = m[1].trim(); if (t) errors.push(t); }
  for (const m of s.matchAll(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/gi))   { const t = m[1].trim(); if (t) errors.push(t); }
  for (const m of s.matchAll(/<EXCEPTION>([\s\S]*?)<\/EXCEPTION>/gi))   { const t = m[1].trim(); if (t) errors.push(t); }
  for (const m of s.matchAll(/<IMPORTMESSAGE>([\s\S]*?)<\/IMPORTMESSAGE>/gi)) { const t = m[1].trim(); if (t) errors.push(t); }

  const excCount = parseInt(s.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1] || '0');
  if (excCount > 0 && !errors.length) errors.push(`EXCEPTIONS=${excCount}`);

  const created  = parseInt(s.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1]  || '0');
  const altered  = parseInt(s.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1]  || '0');
  const diagnosticsFound = errors.length > 0;

  LOG(`${label} → created:${created} altered:${altered} exceptions:${excCount} errors:${errors.length}`);

  const ok = errors.length === 0 && excCount === 0;
  return ok
    ? { ok: true,  created, altered, exceptions: 0, diagnosticsFound }
    : { ok: false, error: errors.join(' | ') || `EXCEPTIONS=${excCount}`, created, altered, exceptions: excCount, diagnosticsFound };
}

// ─── sendImportWithFallbackDebug (mirrors Sales export exactly) ───────────────

async function sendImportWithFallbackDebug(cfg, reportName, innerXml, label, timeoutMs = 40000) {
  const envelope = importEnvelope(cfg, reportName, innerXml);
  const body     = await postXml(cfg, envelope, timeoutMs);
  let result     = parseResponse(body, label);

  if (result.exceptions > 0 && !result.diagnosticsFound) {
    ERR(`${label}: EXCEPTIONS=${result.exceptions} with no diagnostics. Retrying in debug mode.`);
    const debugEnvelope = importDebugEnvelope(cfg, reportName, innerXml);
    const debugBody     = await postXml(cfg, debugEnvelope, timeoutMs);
    const debugResult   = parseResponse(debugBody, `${label} (Debug Fallback)`);
    if (!debugResult.ok || debugResult.diagnosticsFound) {
      result = { ...result, ...debugResult };
    }
  }

  return result;
}

// ─── Ping XML (detects which company is open in Tally) ───────────────────────
// Identical to Sales export PING_XML — uses OpenCompanyList collection,
// works across all Tally editions including Tally Prime Gold.

const PING_XML = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>OpenCompanyList</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="OpenCompanyList" ISMODIFY="No">
      <TYPE>Company</TYPE>
      <FETCH>Name</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

// ─── Tally period-end fetch ───────────────────────────────────────────────────

async function fetchPeriodEnd(cfg) {
  try {
    const resp = await postXmlWithRetry(cfg, PING_XML, cfg.useConnector && cfg.connectorId ? 90000 : 30000);
    const end  = resp?.match(/<ENDINGAT>(.*?)<\/ENDINGAT>/i)?.[1]?.trim();
    if (!end) return null;
    // Convert DD-MMM-YYYY → YYYYMMDD
    const MONTHS = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06', jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
    const p = end.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
    if (!p) return null;
    return `${p[3]}${MONTHS[p[2].toLowerCase()] || '03'}${p[1].padStart(2,'0')}`;
  } catch { return null; }
}

// ─── GST ledger names from Tally ─────────────────────────────────────────────

async function fetchTallyGstLedgerNames(cfg) {
  try {
    const co    = (cfg.companyName || '').trim().toUpperCase();
    const coTag = co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : '';
    const xml   = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>POGSTLedgers</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="POGSTLedgers"><TYPE>Ledger</TYPE>
      <FETCH>Name,Parent,TaxType</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;
    const resp = await postXmlWithRetry(cfg, xml, cfg.useConnector && cfg.connectorId ? 90000 : 30000);
    const cgstNames = []; const sgstNames = []; const igstNames = [];
    for (const m of (resp || '').matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
      const block = m[1];
      const name  = (block.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
      const tax   = (block.match(/<TAXTYPE>(.*?)<\/TAXTYPE>/i)?.[1] || '').toLowerCase();
      if (!name) continue;
      if (tax.includes('central'))    cgstNames.push(name);
      else if (tax.includes('state')) sgstNames.push(name);
      else if (tax.includes('integrated') || name.toLowerCase().includes('igst')) igstNames.push(name);
    }
    return { cgstNames, sgstNames, igstNames };
  } catch { return { cgstNames: [], sgstNames: [], igstNames: [] }; }
}

/** Pick the best GST ledger name from a list, falling back to defaultName. */
function pickGstLedger(names, defaultName) {
  return names?.[0] || defaultName;
}

// ─── Existing Purchase voucher number map ─────────────────────────────────────

async function fetchExistingPurchaseVoucherMap(cfg, purchaseVoucherTypeName) {
  try {
    const co    = (cfg.companyName || '').trim().toUpperCase();
    const coTag = co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : '';
    const xml   = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>POVouchNos</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="POVouchNos"><TYPE>Voucher</TYPE>
      <FETCH>GUID,VoucherNumber,VoucherTypeName</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;
    const resp = await postXmlWithRetry(cfg, xml, (cfg.useConnector && cfg.connectorId) ? 180000 : 30000);
    if (!resp) return new Map();

    const map  = new Map();
    const vtKey = purchaseVoucherTypeName.toLowerCase();
    for (const m of resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)) {
      const block = m[1];
      const vtype = (block.match(/<VOUCHERTYPENAME>(.*?)<\/VOUCHERTYPENAME>/i)?.[1] || '').trim().toLowerCase();
      if (!vtype.startsWith(vtKey.slice(0, 4))) continue;  // must start with "purc"
      const vno  = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1] || '').trim().toUpperCase();
      const guid = (block.match(/<GUID>(.*?)<\/GUID>/i)?.[1] || '').trim();
      if (vno) map.set(`${vtype}|${vno}`, { guid, voucherTypeName: block.match(/<VOUCHERTYPENAME>(.*?)<\/VOUCHERTYPENAME>/i)?.[1]?.trim() || '' });
    }
    LOG(`fetchExistingPurchaseVoucherMap: ${map.size} Purchase vouchers found in Tally`);
    return map;
  } catch (e) {
    ERR('fetchExistingPurchaseVoucherMap failed (non-fatal):', e.message);
    return new Map();
  }
}

// ─── TallySyncLog writer ──────────────────────────────────────────────────────

async function writeLog({ syncId, status, duration, error, records, triggeredBy }) {
  try {
    await TallySyncLog.create({
      syncId, type: 'Purchase', entity: 'POInvoice',
      direction: 'ERP → Tally',
      status, duration, error: error || '', records: records || 0, triggeredBy,
    });
  } catch (_) { /* non-fatal */ }
}

async function logInvoiceResult(syncId, invoiceNo, vendorName, status, detail) {
  try {
    await TallySyncLog.create({
      syncId,
      type:      'Purchase',
      entity:    invoiceNo,
      direction: 'ERP → Tally',
      status,
      duration:  '0s',
      error:     status !== 'Success' ? (detail || '') : '',
      records:   status === 'Success' ? 1 : 0,
      triggeredBy: null,
    });
  } catch (_) {}
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validatePOInvoiceForExport(inv) {
  if (!inv.invoiceNo || !String(inv.invoiceNo).trim())
    return { valid: false, reason: 'Invoice number is missing' };
  if (!inv.vendorName || !String(inv.vendorName).trim())
    return { valid: false, reason: `Invoice ${inv.invoiceNo}: vendorName is missing` };
  const total = +(inv.grandTotal || 0);
  if (!total || total <= 0)
    return { valid: false, reason: `Invoice ${inv.invoiceNo}: grandTotal is zero or missing` };
  return { valid: true };
}

// ─── Build Purchase voucher XML for one POInvoice ────────────────────────────

function buildPurchaseVoucherXml({
  inv, action, guidTag, voucherDate,
  purchaseVoucherTypeName, tallyGstLedgers,
}) {
  const partyName   = (inv.vendorName || '').trim();
  const voucherNo   = String(inv.invoiceNo).trim();
  const items       = inv.items || [];
  const narration   = inv.poRef ? `Against PO: ${inv.poRef}` : '';

  // ── Amounts ───────────────────────────────────────────────────────────────
  const subtotal = +items.reduce((s, it) => s + (+(it.invoicedQty || 0)) * (+(it.basePrice || 0)), 0).toFixed(2);

  const cgstRaw = +items.reduce((s, it) => s + (+(it.cgstVal || 0)), 0).toFixed(2);
  const sgstRaw = +items.reduce((s, it) => s + (+(it.sgstVal || 0)), 0).toFixed(2);
  const igstRaw = +items.reduce((s, it) => s + (+(it.igstVal || 0)), 0).toFixed(2);

  const gstTotal = +(inv.gstTotal || 0);
  const cgst = cgstRaw || +(gstTotal / 2).toFixed(2);
  const sgst = sgstRaw || +(gstTotal - cgst).toFixed(2);
  const igst = igstRaw;

  const grandTotal   = +(inv.grandTotal || subtotal + cgst + sgst + igst).toFixed(2);
  const purchaseBase = subtotal;

  // ── GST ledger names ──────────────────────────────────────────────────────
  const cgstLedger = pickGstLedger(tallyGstLedgers?.cgstNames, 'CGST');
  const sgstLedger = pickGstLedger(tallyGstLedgers?.sgstNames, 'SGST');
  const igstLedger = pickGstLedger(tallyGstLedgers?.igstNames, 'IGST');

  // ── Inventory lines ───────────────────────────────────────────────────────
  let allocated = 0;
  const inventoryLines = items.map((it, i) => {
    const qty   = +(it.invoicedQty || 0);
    const rate  = +(it.basePrice   || 0);
    const total = +(qty * rate).toFixed(2);
    const unit  = tallyUnit(it.unit);
    const isLast = i === items.length - 1;
    const alloc  = isLast
      ? +(purchaseBase - allocated).toFixed(2)
      : +(subtotal > 0 ? (total / subtotal) * purchaseBase : purchaseBase / items.length).toFixed(2);
    allocated = +(allocated + alloc).toFixed(2);

    return `
<ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>${esc(it.itemName || 'Item')}</STOCKITEMNAME>
  <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
  <GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
  <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
  <ISGSTASSESSABLEVALUEOVERRIDDEN>No</ISGSTASSESSABLEVALUEOVERRIDDEN>
  <RATE>${rate.toFixed(2)} /1 ${unit}</RATE>
  <AMOUNT>${alloc.toFixed(2)}</AMOUNT>
  <ACTUALQTY> ${qty} ${unit}</ACTUALQTY>
  <BILLEDQTY> ${qty} ${unit}</BILLEDQTY>
  <BATCHALLOCATIONS.LIST>
    <AMOUNT>${alloc.toFixed(2)}</AMOUNT>
    <ACTUALQTY> ${qty} ${unit}</ACTUALQTY>
    <BILLEDQTY> ${qty} ${unit}</BILLEDQTY>
    <ADDITIONALDETAILS.LIST></ADDITIONALDETAILS.LIST>
    <VOUCHERCOMPONENTLIST.LIST></VOUCHERCOMPONENTLIST.LIST>
  </BATCHALLOCATIONS.LIST>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>Purchase Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISGSTASSESSABLEVALUEOVERRIDDEN>No</ISGSTASSESSABLEVALUEOVERRIDDEN>
    <AMOUNT>${alloc.toFixed(2)}</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`;
  }).join('');

  // ── Assemble voucher ──────────────────────────────────────────────────────
  return `
<VOUCHER VCHTYPE="${esc(purchaseVoucherTypeName)}" ACTION="${action}" OBJVIEW="Invoice Voucher View">
  <DATE>${voucherDate}</DATE>
  <EFFECTIVEDATE>${voucherDate}</EFFECTIVEDATE>
  <OLDAUDITENTRYIDS.LIST TYPE="Number"><OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS></OLDAUDITENTRYIDS.LIST>
  <VCHSTATUSDATE>${voucherDate}</VCHSTATUSDATE>
  <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
  ${guidTag}
  <VOUCHERTYPENAME>${esc(purchaseVoucherTypeName)}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(voucherNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(partyName)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>${esc(narration)}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(voucherNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  ${cgst > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(cgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>${cgst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>` : ''}
  ${sgst > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(sgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>${sgst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>` : ''}
  ${igst > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(igstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>${igst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>` : ''}
  ${inventoryLines}
</VOUCHER>`;
}

// ─── Main export function ─────────────────────────────────────────────────────

/**
 * Export unsynced POInvoice records to Tally as Purchase vouchers.
 * Process flow mirrors exportSalesInvoices() exactly.
 *
 * @param {object} cfg         - TallyConfig document
 * @param {string} triggeredBy - User ID
 */
export async function exportPOInvoicesToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-POINV-${Date.now()}`;
  LOG('exportPOInvoicesToTally START');

  try {
    // ── Step 0: Re-read fresh cfg from DB ─────────────────────────────────────
    try {
      const freshCfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
      if (freshCfg) Object.assign(cfg, freshCfg.toObject ? freshCfg.toObject() : freshCfg);
    } catch (_) {}

    // ── Step 0: Company auto-detect + mismatch guard ──────────────────────────
    try {
      const pingResp        = await postXmlWithRetry(cfg, PING_XML, cfg.useConnector && cfg.connectorId ? 90000 : 30000);
      const detectedCompany = parseOpenCompanyListResponse(pingResp);
      const savedCompany   = (cfg.companyName || '').trim();

      LOG(`exportPOInvoicesToTally: saved="${savedCompany}" detected="${detectedCompany || '(not detected)'}"`);

      if (!detectedCompany) {
        return { ok: false, records: 0, error: 'Cannot detect open company in Tally. Open the target company first.' };
      }
      if (!savedCompany) {
        cfg.companyName = detectedCompany;
        await TallyConfig.findOneAndUpdate({}, { companyName: detectedCompany }, { sort: { _id: 1 } });
      } else if (detectedCompany.toUpperCase() !== savedCompany.toUpperCase()) {
        return { ok: false, records: 0, error: `COMPANY MISMATCH: Tally has "${detectedCompany}" open, config expects "${savedCompany}". Open the correct company or update Tally settings.` };
      }
    } catch (pingErr) {
      LOG(`exportPOInvoicesToTally: company auto-detect failed (non-fatal): ${pingErr.message}`);
    }

    if (!cfg.companyName || !cfg.companyName.trim()) {
      return { ok: false, records: 0, error: 'Tally company name is not configured. Go to Tally Settings → Test Connection, then retry.' };
    }

    // ── Step 0.6: Purchase voucher type probe ─────────────────────────────────
    // Some companies rename "Purchase" to "Purchase Invoice" etc. Find the real name.
    let purchaseVoucherTypeName = 'Purchase';
    try {
      const co    = (cfg.companyName || '').trim().toUpperCase();
      const coTag = co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : '';
      const vtXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>POVTProbe</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="POVTProbe"><TYPE>VoucherType</TYPE><FETCH>Name</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;
      const vtResp  = await postXml(cfg, vtXml, 30000);
      const allVTypes = [...(vtResp || '').matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim()).filter(Boolean);
      LOG(`exportPOInvoicesToTally: Tally voucher types: [${allVTypes.join(', ')}]`);
      const purchType = allVTypes.find(n => n.toLowerCase().startsWith('purchas'));
      if (purchType) {
        purchaseVoucherTypeName = purchType;
        LOG(`exportPOInvoicesToTally: using voucher type "${purchaseVoucherTypeName}"`);
      }
    } catch (vtErr) {
      LOG(`exportPOInvoicesToTally: voucher type probe failed (non-fatal): ${vtErr.message}`);
    }

    // ── Step 0.5: Fetch live GST ledger names from Tally ──────────────────────
    // Always fetch GST ledger names regardless of connector mode.
    // Previously this was skipped in connector mode which left tallyGstLedgers=null,
    // causing buildPurchaseVoucherXml to fall back to hardcoded 'CGST'/'SGST'/'IGST'
    // names that may not match the actual ledger names in Tally → EXCEPTIONS on every export.
    let tallyGstLedgers = null;
    try {
      tallyGstLedgers = await fetchTallyGstLedgerNames(cfg);
      LOG(`exportPOInvoicesToTally: GST ledgers — cgst:[${(tallyGstLedgers?.cgstNames||[]).join(', ')}] sgst:[${(tallyGstLedgers?.sgstNames||[]).join(', ')}] igst:[${(tallyGstLedgers?.igstNames||[]).join(', ')}]`);
    } catch (gstErr) {
      LOG(`exportPOInvoicesToTally: GST ledger fetch failed (non-fatal): ${gstErr.message}`);
      tallyGstLedgers = { cgstNames: [], sgstNames: [], igstNames: [] };
    }

    // ── Step 1: Fetch unsynced POInvoices ─────────────────────────────────────
    const invoices = await POInvoice.find({
      status:    { $in: ['Approved', 'Paid', 'Sent'] },
      $and: [
        { $or: [{ tallySync: { $ne: true } }, { tallySync: true, tallySyncAt: { $exists: false } }] },
        { $or: [{ retryCount: { $exists: false } }, { retryCount: { $lte: MAX_RETRIES } }] },
      ],
    }).lean();

    if (!invoices.length) {
      const blocked = await POInvoice.countDocuments({
        status: { $in: ['Approved', 'Paid', 'Sent'] },
        tallySync: { $ne: true },
        retryCount: { $gt: MAX_RETRIES },
      });
      if (blocked) LOG(`exportPOInvoicesToTally: ${blocked} invoices excluded — retryCount > ${MAX_RETRIES}`);
      LOG('exportPOInvoicesToTally: 0 pending PO invoices — nothing to export');
      return { ok: true, records: 0 };
    }

    LOG(`exportPOInvoicesToTally: ${invoices.length} PO invoice(s) to export`);

    // ── Step 2: Fetch godown names from Tally ─────────────────────────────────
    let resolvedDefaultGodown = 'Main Location';
    try {
      const co    = (cfg.companyName || '').trim().toUpperCase();
      const coTag = co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : '';
      const gdXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>POGodownList</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="POGodownList"><TYPE>Godown</TYPE><FETCH>Name</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;
      const gdResp = await postXml(cfg, gdXml, 20000);
      const godownNames = [];
      for (const m of (gdResp || '').matchAll(/<GODOWN[^>]*>([\s\S]*?)<\/GODOWN>/gi)) {
        const name = (m[1].match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
        if (name) godownNames.push(name);
      }
      LOG(`exportPOInvoicesToTally: Tally godowns: [${godownNames.join(', ')}]`);
      if (godownNames.length) {
        resolvedDefaultGodown = godownNames.find(g => /srichakra/i.test(g)) || godownNames.find(g => /main/i.test(g)) || godownNames[0];
        LOG(`exportPOInvoicesToTally: resolved default godown = "${resolvedDefaultGodown}"`);
      }
    } catch (gErr) {
      LOG(`exportPOInvoicesToTally: godown fetch failed (non-fatal): ${gErr.message}`);
    }

    // ── Step 3: Auto-create vendor ledgers + Purchase Accounts + stock items ──
    const vendorNames = [...new Set(invoices.map(inv => (inv.vendorName || '').trim()).filter(Boolean))];
    const stockNames  = [...new Set(invoices.flatMap(inv => (inv.items || []).map(it => (it.itemName || '').trim())).filter(Boolean))];

    // Fetch current stock item GST rates from Tally (same smart Create/Alter logic as Sales)
    let tallyStockGstMap = new Map();
    try {
      const co    = (cfg.companyName || '').trim().toUpperCase();
      const coTag = co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : '';
      const sgXml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>POStockGST</ID></HEADER>
<BODY><DESC><STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="POStockGST"><TYPE>Stock Item</TYPE><FETCH>Name,GSTApplicable,GSTRate</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;
      const sgResp = await postXmlWithRetry(cfg, sgXml, cfg.useConnector && cfg.connectorId ? 90000 : 30000);
      if (sgResp) {
        for (const m of sgResp.matchAll(/<STOCKITEM[^>]*NAME="([^"]+)"[^>]*>([\s\S]*?)<\/STOCKITEM>/gi)) {
          const iname = m[1].trim();
          const rate  = parseFloat((m[2].match(/<GSTRATE>(.*?)<\/GSTRATE>/i)?.[1] || '0'));
          tallyStockGstMap.set(iname.toLowerCase(), rate);
        }
        LOG(`exportPOInvoicesToTally: fetched GST rates for ${tallyStockGstMap.size} stock items`);
      }
    } catch (e) {
      LOG(`exportPOInvoicesToTally: stock GST fetch failed (non-fatal): ${e.message}`);
    }

    // Build stock item GST rate map from invoice data
    const stockGstRateMap = new Map();
    for (const inv of invoices) {
      for (const it of (inv.items || [])) {
        const name = (it.itemName || '').trim();
        if (!name || stockGstRateMap.has(name)) continue;
        // Full GST % = gst field on item, or back-calculate from cgstVal+sgstVal+igstVal / basePrice*invoicedQty
        let rate = +(it.gst || 0);
        if (!rate) {
          const tax  = (+(it.cgstVal||0)) + (+(it.sgstVal||0)) + (+(it.igstVal||0));
          const base = (+(it.invoicedQty||1)) * (+(it.basePrice||0));
          if (tax > 0 && base > 0) rate = Math.round((tax / base) * 100 * 2) / 2;
        }
        if (rate > 0) stockGstRateMap.set(name, rate);
      }
    }

    // Build stock item HSN map
    const stockHsnMap = new Map();
    for (const inv of invoices) {
      for (const it of (inv.items || [])) {
        const name = (it.itemName || '').trim();
        if (name && !stockHsnMap.has(name) && it.hsn) stockHsnMap.set(name, it.hsn);
      }
    }

    // Smart Create/Alter stock items (same logic as Sales export)
    const autoStockXml = stockNames.map(name => {
      const gstRate = stockGstRateMap.get(name) || 0;
      const hsn     = stockHsnMap.get(name) || '';
      const gstRateTag     = gstRate > 0 ? `<GSTRATE>${gstRate}</GSTRATE>` : '';
      const hsnTag         = hsn ? `<HSNCODE>${esc(hsn)}</HSNCODE>` : '';
      const gstDetailsTag  = gstRate > 0
        ? `<GSTDETAILS.LIST ACTION="Replace"><APPLICABLEFROM>20230401</APPLICABLEFROM><TAXABILITY>Taxable</TAXABILITY><GSTRATEINPERCENT>${gstRate}</GSTRATEINPERCENT><ISREVERSECHARGE>No</ISREVERSECHARGE><ISINELIGIBLEITC>No</ISINELIGIBLEITC><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY></GSTDETAILS.LIST>`
        : '';

      const tallyCurrentRate = tallyStockGstMap.get(name.toLowerCase());
      const existsInTally    = tallyCurrentRate !== undefined;
      const tallyRateIsMissing = existsInTally && tallyCurrentRate === 0;

      if (!existsInTally) {
        return `<STOCKITEM NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><UNITS>Nos</UNITS><GSTAPPLICABLE>Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>${hsnTag}${gstRateTag}${gstDetailsTag}</STOCKITEM>`;
      } else if (tallyRateIsMissing && gstRate > 0) {
        LOG(`exportPOInvoicesToTally: stock item "${name}" has no GST rate in Tally → setting to ${gstRate}%`);
        return `<STOCKITEM NAME="${esc(name)}" ACTION="Alter"><NAME>${esc(name)}</NAME><GSTAPPLICABLE>Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>${hsnTag}${gstRateTag}${gstDetailsTag}</STOCKITEM>`;
      }
      return '';  // exists with correct rate — leave untouched
    }).filter(Boolean).join('');

    const autoLedgerXml = [
      `<LEDGER NAME="Purchase Accounts" ACTION="Create"><NAME>Purchase Accounts</NAME><PARENT>Purchase Accounts</PARENT></LEDGER>`,
      ...vendorNames.map(n => `<LEDGER NAME="${esc(n)}" ACTION="Create"><NAME>${esc(n)}</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>`),
    ].join('');
    // NOTE: GST ledgers (CGST/SGST/IGST) are NOT auto-created via XML — same rule as Sales export.
    // They must be created manually in Tally with the correct Tax Type settings.

    LOG(`PO Export: auto-creating ${vendorNames.length} vendor ledgers + ${stockNames.length} stock items`);
    const mastersEnv  = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${autoLedgerXml}${autoStockXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;
    const mastersResp = await postXml(cfg, mastersEnv, 60000);
    parseResponse(mastersResp, 'PO Invoice Auto-Masters');

    // ── Step 4: Fetch existing voucher numbers (dedup) ─────────────────────────
    const existingVoucherMap = await fetchExistingPurchaseVoucherMap(cfg, purchaseVoucherTypeName);
    LOG(`exportPOInvoicesToTally: ${existingVoucherMap.size} existing Purchase vouchers in Tally`);

    // ── Step 4b: Fetch Tally period end to cap dates ──────────────────────────
    let periodEnd = await fetchPeriodEnd(cfg);
    const today   = todayStr();
    if (periodEnd && periodEnd < today) {
      LOG(`exportPOInvoicesToTally: Tally periodEnd "${periodEnd}" is in the past — NOT capping dates`);
      await TallyConfig.findOneAndUpdate({}, { $unset: { tallyPeriodEnd: 1 } }, { sort: { _id: 1 } });
      periodEnd = null;
    } else if (periodEnd) {
      await TallyConfig.findOneAndUpdate({}, { tallyPeriodEnd: periodEnd }, { sort: { _id: 1 } });
      LOG(`exportPOInvoicesToTally: voucher dates capped to ${periodEnd}`);
    } else {
      const saved = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
      const cached = saved?.tallyPeriodEnd;
      if (cached && cached >= today) { periodEnd = cached; LOG(`exportPOInvoicesToTally: using cached periodEnd: ${periodEnd}`); }
    }

    // ── Step 5: Build per-invoice XML ─────────────────────────────────────────
    const vouchersXml    = [];
    const failedItems    = [];
    const preflightErrors = [];
    const failedInvoiceIds = [];
    const invoiceErrorMap  = {};

    for (let idx = 0; idx < invoices.length; idx++) {
      const inv = invoices[idx];
      try {
        // Pre-export validation
        const validation = validatePOInvoiceForExport(inv);
        if (!validation.valid) {
          const errMsg = `Validation: ${validation.reason}`;
          LOG(`PO Invoice ${inv.invoiceNo}: SKIPPED — ${errMsg}`);
          failedItems.push({ id: inv.invoiceNo, error: errMsg });
          failedInvoiceIds.push(inv._id);
          invoiceErrorMap[String(inv._id)] = errMsg;
          await logInvoiceResult(syncId, inv.invoiceNo || '?', inv.vendorName || '?', 'Failed', errMsg);
          continue;
        }

        // Dedup: check if this voucher number already exists in Tally
        const invNoUpper = String(inv.invoiceNo).trim().toUpperCase();
        const vtKey      = purchaseVoucherTypeName.toLowerCase();
        const existingKey = `${vtKey}|${invNoUpper}`;
        const existingVoucher = existingVoucherMap.get(existingKey);

        if (idx < 3) {
          LOG(`DEDUP CHECK invoice[${idx}] key="${existingKey}" — already in Tally: ${Boolean(existingVoucher)}`);
        }

        const shouldAlter = Boolean(existingVoucher || inv.tallyGuid);
        const action      = shouldAlter ? 'Alter' : 'Create';
        const guidTag     = existingVoucher?.guid ? `<GUID>${esc(existingVoucher.guid)}</GUID>`
                          : inv.tallyGuid          ? `<GUID>${esc(inv.tallyGuid)}</GUID>` : '';

        LOG(`PO Invoice ${inv.invoiceNo}: action=${action} grandTotal=${inv.grandTotal} vendor="${inv.vendorName}"`);

        // Voucher date
        const rawDate    = td(inv.invoiceDate || inv.createdAt) || today;
        const voucherDate = capTallyDate(rawDate, periodEnd);

        const xml = buildPurchaseVoucherXml({
          inv, action, guidTag, voucherDate,
          purchaseVoucherTypeName, tallyGstLedgers,
        });

        // Debug log first invoice XML
        if (idx === 0) {
          LOG(`PO EXPORT: FIRST INVOICE XML:\n${xml}`);
          console.log(`\n========== PO EXPORT DEBUG XML for ${inv.invoiceNo} ==========`);
          console.log(xml);
          console.log(`========== END XML ==========\n`);
        }

        vouchersXml.push({ id: inv._id, invoiceNo: inv.invoiceNo, vendorName: inv.vendorName || '', xml });
      } catch (e) {
        const errMsg = `Build error: ${e.message}`;
        failedItems.push({ id: inv.invoiceNo, error: errMsg });
        failedInvoiceIds.push(inv._id);
        invoiceErrorMap[String(inv._id)] = errMsg;
        await logInvoiceResult(syncId, inv.invoiceNo || '?', inv.vendorName || '?', 'Failed', errMsg);
      }
    }

    // ── Step 6: Send one voucher per request (same as Sales export) ─────────────
    const BATCH_SIZE  = 1;
    let totalCreated  = 0, totalAltered = 0;
    const batchErrors = [...preflightErrors];
    const successIds  = [];

    for (let b = 0; b < vouchersXml.length; b += BATCH_SIZE) {
      const batch   = vouchersXml.slice(b, b + BATCH_SIZE);
      const batchNo = Math.floor(b / BATCH_SIZE) + 1;
      const batchTot= Math.ceil(vouchersXml.length / BATCH_SIZE);
      LOG(`PO Export batch ${batchNo}/${batchTot} — ${batch.length} vouchers`);

      const singleXml = batch.map(v => v.xml).join('');

      if (b === 0) {
        const fullEnv = importEnvelope(cfg, 'Vouchers', singleXml);
        LOG(`PO DEBUG — first batch full XML (company=${cfg.companyName || 'EMPTY'}):\n${fullEnv}`);
      }

      const result = await sendImportWithFallbackDebug(cfg, 'Vouchers', singleXml, `PO Invoices batch ${batchNo}/${batchTot}`, 60000);

      // ── Error classification ───────────────────────────────────────────────
      const errorText = (result.error || '').toLowerCase();
      const isMasterNotFoundError =
        errorText.includes('does not exist') ||
        errorText.includes('godown')         ||
        errorText.includes('ledger')         ||
        errorText.includes('stock item')     ||
        errorText.includes('not found')      ||
        errorText.includes('master')         ||
        errorText.includes('could not find');

      if (isMasterNotFoundError && !result.ok) {
        // Master-data failure — fail fast, do not Alter or Delete
        const masterErr = `Master data error (fix in Tally first): ${result.error}`;
        ERR(`PO batch ${batchNo}: ${masterErr}`);
        batchErrors.push(`Batch ${batchNo}: ${masterErr}`);
        for (const bv of batch) {
          failedInvoiceIds.push(bv.id);
          invoiceErrorMap[String(bv.id)] = masterErr;
          await logInvoiceResult(syncId, bv.invoiceNo, bv.vendorName, 'Failed', masterErr);
        }
        continue;
      }

      if (!result.ok) {
        // Non-master failure — retry as Alter
        const v = batch[0];
        LOG(`PO batch ${batchNo}: ${result.error || 'failed'} — retrying ${v.invoiceNo} as Alter…`);

        const alterXml      = v.xml.replace(/ACTION="Create"/, 'ACTION="Alter"');
        const alterEnvelope = importEnvelope(cfg, 'Vouchers', alterXml);
        const alterResp     = await postXml(cfg, alterEnvelope, 60000);
        const alterResult   = parseResponse(alterResp, `PO batch ${batchNo}/${batchTot} [Alter retry]`);

        if (alterResult.ok) {
          totalCreated += alterResult.created || 0;
          totalAltered += alterResult.altered || 0;
          successIds.push(v.id);
          await logInvoiceResult(syncId, v.invoiceNo, v.vendorName, 'Success', 'Sent as Alter (was duplicate Create)');
          existingVoucherMap.set(`${purchaseVoucherTypeName.toLowerCase()}|${String(v.invoiceNo).trim().toUpperCase()}`, { guid: '', voucherTypeName: purchaseVoucherTypeName });
        } else {
          // Alter also failed — try Delete+Create if we have a GUID
          const alterErrText      = (alterResult.error || '').toLowerCase();
          const alterIsMasterError = alterErrText.includes('does not exist') || alterErrText.includes('not found') || alterErrText.includes('ledger');
          const hasGuidInXml      = /<GUID>[^<]+<\/GUID>/i.test(v.xml);

          if (alterIsMasterError || !hasGuidInXml) {
            const stopReason = alterIsMasterError
              ? `Alter failed with master error — fix masters: ${alterResult.error}`
              : `Alter failed and no GUID — cannot Delete: ${alterResult.error}`;
            ERR(`PO batch ${batchNo}: ${stopReason}`);
            batchErrors.push(`Batch ${batchNo}: ${stopReason}`);
            failedInvoiceIds.push(v.id);
            invoiceErrorMap[String(v.id)] = stopReason;
            await logInvoiceResult(syncId, v.invoiceNo, v.vendorName, 'Failed', stopReason);
          } else {
            LOG(`PO batch ${batchNo}: Alter rejected — attempting Delete+Create for ${v.invoiceNo}`);
            try {
              const deleteXml      = v.xml.replace(/ACTION="(Create|Alter)"/, 'ACTION="Delete"');
              const deleteResp     = await postXml(cfg, importEnvelope(cfg, 'Vouchers', deleteXml), 60000);
              parseResponse(deleteResp, `PO batch ${batchNo} [Delete]`);

              const reCreateXml    = v.xml.replace(/ACTION="(Alter|Delete)"/, 'ACTION="Create"').replace(/<GUID>[^<]*<\/GUID>\s*/gi, '');
              const reCreateResp   = await postXml(cfg, importEnvelope(cfg, 'Vouchers', reCreateXml), 60000);
              const reCreateResult = parseResponse(reCreateResp, `PO batch ${batchNo} [Delete+Create]`);

              if (reCreateResult.ok && (reCreateResult.created || 0) > 0) {
                totalCreated += reCreateResult.created || 0;
                successIds.push(v.id);
                await logInvoiceResult(syncId, v.invoiceNo, v.vendorName, 'Success', 'Re-created after Delete');
              } else {
                const finalErr = reCreateResult.error || 'Tally rejected Delete+Create';
                batchErrors.push(`Batch ${batchNo}: ${finalErr}`);
                failedInvoiceIds.push(v.id);
                invoiceErrorMap[String(v.id)] = finalErr;
                await logInvoiceResult(syncId, v.invoiceNo, v.vendorName, 'Failed', finalErr);
              }
            } catch (delErr) {
              const errMsg = `Delete+Create error: ${delErr.message}`;
              ERR(`PO batch ${batchNo}: ${errMsg}`);
              batchErrors.push(`Batch ${batchNo}: ${errMsg}`);
              failedInvoiceIds.push(v.id);
              invoiceErrorMap[String(v.id)] = errMsg;
              await logInvoiceResult(syncId, v.invoiceNo, v.vendorName, 'Failed', errMsg);
            }
          }
        }
        continue;
      }

      // ── Success ─────────────────────────────────────────────────────────────
      totalCreated += result.created || 0;
      totalAltered += result.altered || 0;
      for (const bv of batch) {
        successIds.push(bv.id);
        await logInvoiceResult(syncId, bv.invoiceNo, bv.vendorName, 'Success', null);
      }
    }

    // ── Step 9: Mark successful invoices as synced ────────────────────────────
    if (successIds.length > 0) {
      await POInvoice.updateMany(
        { _id: { $in: successIds } },
        { tallySync: true, tallySyncAt: new Date(), retryCount: 0, lastError: '', lastTriedAt: new Date() }
      );
    }

    // ── Step 9b: Increment retryCount on failed invoices ─────────────────────
    if (failedInvoiceIds.length > 0) {
      for (const invoiceId of failedInvoiceIds) {
        await POInvoice.findByIdAndUpdate(
          invoiceId,
          { $inc: { retryCount: 1 }, lastError: invoiceErrorMap[String(invoiceId)] || 'Unknown error', lastTriedAt: new Date() },
          { new: true }
        );
      }
    }

    // ── Step 10: Summary log ──────────────────────────────────────────────────
    const overallOk = batchErrors.length === 0;
    const dur = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, status: overallOk ? 'Success' : 'Failed', duration: dur, error: batchErrors.join('; '), records: invoices.length, triggeredBy });

    LOG(`exportPOInvoicesToTally complete — success:${successIds.length} failed:${failedItems.length} batchErrors:${batchErrors.length} in ${dur}`);

    return {
      ok:      overallOk,
      records: invoices.length,
      created: totalCreated,
      altered: totalAltered,
      error:   batchErrors.length ? batchErrors.join('; ') : undefined,
      failedItems,
    };

  } catch (err) {
    ERR('exportPOInvoicesToTally:', err.message);
    const dur = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, status: 'Failed', duration: dur, error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

/**
 * Count PO Invoices pending Tally export (pre-flight count).
 */
export async function getPOInvoiceExportCount() {
  return POInvoice.countDocuments({
    status:    { $in: ['Approved', 'Paid', 'Sent'] },
    $and: [
      { $or: [{ tallySync: { $ne: true } }, { tallySync: true, tallySyncAt: { $exists: false } }] },
      { $or: [{ retryCount: { $exists: false } }, { retryCount: { $lte: MAX_RETRIES } }] },
    ],
  });
}
