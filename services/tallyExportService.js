/**
 * tallyExportService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Dedicated ERP → Tally export engine for Sri Chakra Industries.
 *
 * Covers ALL required entity types:
 *   Masters  : Stock Groups, Stock Categories, Units of Measure, Godowns,
 *              Stock Items (with Opening Stock + GST), Ledger Masters,
 *              Customer Masters, Supplier/Vendor Masters
 *   Vouchers : Sales Invoices, Purchase Invoices, Credit Notes, Debit Notes,
 *              Payment Vouchers, Receipt Vouchers, Journal Vouchers
 *
 * Design principles:
 *   • Uses GUID + name as dedup key → no duplicates on re-export
 *   • Per-entity error isolation — one failure does not abort the rest
 *   • Returns structured results consumed by the SSE streaming endpoint
 *   • importFromTally() / exportToTally() method stubs for future-readiness
 */

import fs             from 'fs';
import path           from 'path';
import TallyConfig    from '../models/TallyConfig.js';
import TallySyncLog   from '../models/TallySyncLog.js';
import ItemMaster     from '../models/ItemMaster.js';
import Inventory      from '../models/Inventory.js';
import Warehouse      from '../models/Warehouse.js';
import Vendor         from '../models/Vendor.js';
import Client         from '../models/Client.js';
import CorporateClient from '../models/CorporateClient.js';
import AccountsLedger from '../models/AccountsLedger.js';
import PurchaseOrder  from '../models/PurchaseOrder.js';
import Invoice        from '../models/Invoice.js';
import CreditNote     from '../models/CreditNote.js';
import DebitNote      from '../models/DebitNote.js';
import TallyVoucher   from '../models/TallyVoucher.js';
import Category       from '../models/Category.js';
import { postXmlWithRetry } from './tallyFetchEngine.js';
import { normalizeToTallyVoucher } from './normalizeToTallyVoucher.js';

const LOG = (...a) => console.log('[TallyExport]', ...a);
const ERR = (...a) => console.error('[TallyExport ERROR]', ...a);

// ─── CONFIG HELPERS ───────────────────────────────────────────────────────────

export async function getExportConfig() {
  let cfg = await TallyConfig.findOne();
  if (!cfg) cfg = await TallyConfig.create({});
  return cfg;
}

/**
 * Resolve the correct URL to POST Tally XML to.
 * Priority: tallyLocalUrl (local machine) > serverUrl (only if not the cloud ERP URL) > localhost fallback
 */
function resolveUrl(cfg) {
  const port  = cfg.port || '9000';

  // ── Priority 1: tallyLocalUrl ─────────────────────────────────────────────
  const local = (cfg.tallyLocalUrl || '').trim();
  if (local) {
    if (local.match(/:\d+$/) || local.startsWith('https://')) return local.replace(/\/$/, '');
    return `${local.replace(/\/$/, '')}:${port}`;
  }

  // ── Priority 2: serverUrl — skip cloud/ERP URLs ──────────────────────────
  const server = (cfg.serverUrl || '').trim();
  if (server && !server.includes('majesticmall.net') && !server.includes('erp.')) {
    if (server.match(/:\d+$/) || server.startsWith('https://')) return server.replace(/\/$/, '');
    return `${server.replace(/\/$/, '')}:${port}`;
  }

  // ── Fallback: localhost ────────────────────────────────────────────────────
  return `http://localhost:${port}`;
}

// ─── XML UTILITIES ────────────────────────────────────────────────────────────

/** Escape XML special characters */
export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Format Date → YYYYMMDD (Tally date format) */
function td(d) {
  const dt = d ? new Date(d) : null;
  if (!dt || isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

const TODAY = td(new Date()) || (() => {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
})();

/**
 * Fetch the ENDINGAT date of the currently open Tally company.
 * Returns YYYYMMDD string, or null if it cannot be determined.
 * This is used to cap voucher dates so they never exceed Tally's period end.
 */
async function fetchTallyPeriodEnd(cfg) {
  try {
    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag   = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';

    // Try Method 1: TDL Company Collection (works when a company is fully open)
    const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>CompanyPeriod</ID>
</HEADER>
<BODY>
  <DESC>
    <STATICVARIABLES>
      ${coTag}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="CompanyPeriod">
        <TYPE>Company</TYPE>
        <FETCH>Name, StartingFrom, EndingAt</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC>
</BODY>
</ENVELOPE>`;
    const resp = await postXmlWithRetry(cfg, xml, cfg.useConnector && cfg.connectorId ? 90000 : 60000, 1);

    // Try ENDINGAT tag first
    const m = resp.match(/<ENDINGAT[^>]*>(\d{8})<\/ENDINGAT>/i);
    if (m) {
      LOG(`Tally company period ends: ${m[1]}`);
      return m[1];
    }

    // Method 2: Parse from SVTODATE in the response envelope
    const svTo = resp.match(/<SVTODATE[^>]*>(\d{8})<\/SVTODATE>/i);
    if (svTo) {
      LOG(`Tally company period ends (via SVTODATE): ${svTo[1]}`);
      return svTo[1];
    }

    // Method 3: Ping for company info using a plain export
    const pingXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>Day Book</REPORTNAME>
  <STATICVARIABLES>
    ${coTag}
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
</REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;
    const pingResp = await postXmlWithRetry(cfg, pingXml, 30000, 1);
    const pm = pingResp.match(/<SVTODATE[^>]*>(\d{8})<\/SVTODATE>/i)
            || pingResp.match(/<ENDINGAT[^>]*>(\d{8})<\/ENDINGAT>/i);
    if (pm) {
      LOG(`Tally company period ends (via DayBook): ${pm[1]}`);
      return pm[1];
    }

    LOG('fetchTallyPeriodEnd: could not determine period end — date will not be capped');
    return null;
  } catch (e) {
    ERR('fetchTallyPeriodEnd failed (non-fatal):', e.message);
    return null;
  }
}

/**
 * Return the most recent valid date for a Tally voucher.
 * - If voucherDate is within Tally's period → return it as-is
 * - If voucherDate > periodEnd → cap to periodEnd
 * - If periodEnd is unknown → return voucherDate unchanged
 */
function capTallyDate(voucherDate, periodEnd) {
  if (!periodEnd) return voucherDate;
  // Both are YYYYMMDD strings — string comparison works correctly for this format
  if (voucherDate > periodEnd) {
    LOG(`Capping voucher date ${voucherDate} → ${periodEnd} (Tally period end)`);
    return periodEnd;
  }
  return voucherDate;
}

/** Map ERP unit strings to Tally UOM names */
const UNIT_MAP = {
  kg: 'Kg', kgs: 'Kg', kilogram: 'Kg', kilogrames: 'Kg',
  liter: 'Ltr', litre: 'Ltr', ltr: 'Ltr', l: 'Ltr',
  meter: 'Mtr', metre: 'Mtr', mtr: 'Mtr', m: 'Mtr',
  box: 'Box', boxes: 'Box',
  piece: 'Pcs', pieces: 'Pcs', pcs: 'Pcs', pc: 'Pcs',
  nos: 'Nos', no: 'Nos', number: 'Nos', units: 'Nos', unit: 'Nos',
  pack: 'Nos', dozen: 'Nos', set: 'Nos', 'Set': 'Nos',
  gm: 'Gm', gram: 'Gm', grams: 'Gm',
  ml: 'Ml', milliliter: 'Ml',
};
const tallyUnit = (u) => UNIT_MAP[(u || '').toLowerCase().trim()] || 'Nos';

/** Build <STATICVARIABLES> tag targeting the configured company */
function staticVars(cfg, extra = '') {
  // Tally stores company names as UPPERCASE internally — always send uppercase.
  // Do NOT fall back to a hardcoded name — if companyName is wrong/empty, the
  // export MUST fail visibly rather than silently sending to the wrong company.
  const co = (cfg.companyName || '').trim().toUpperCase();
  // SVSHOWERRORLIST=Yes forces Tally to include LINEERROR tags in EVERY response
  // so we can see the exact rejection reason instead of just EXCEPTIONS count.
  //
  // NOTE: Do NOT include SVFROMDATE / SVTODATE in import requests.
  // Those are export/reporting variables. When included in an Import Data request,
  // Tally misinterprets them as a date-range filter and rejects vouchers whose date
  // it cannot resolve in that context — producing the misleading
  // "Voucher date is missing" error even when <DATE> is correctly populated.
  return `<STATICVARIABLES>${co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : ''}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST>${extra}</STATICVARIABLES>`;
}

/** Wrap XML payload in Tally Import envelope */
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

// ─── HTTP TRANSPORT ───────────────────────────────────────────────────────────

async function postXml(cfg, xml, timeoutMs = 40000) {
  // Route via connector (if useConnector=true) or direct HTTP — same as tallyFetchEngine.
  // postXmlWithRetry handles both paths transparently.
  //
  // ── Connector timeout scaling ───────────────────────────────────────────────
  // In connector mode, requests travel:  Render cloud → long-poll → connector PC → Tally → back
  // The round-trip adds significant latency on top of Tally's own processing time.
  // Callers pass direct-mode timeouts (e.g. 30s/60s). Scale them up when connector
  // is active so results that arrive late are not discarded as "already timed out".
  const effectiveTimeout = (cfg.useConnector && cfg.connectorId)
    ? Math.max(timeoutMs * 3, 180000)  // at least 3× or 3 min — connector round-trip overhead
    : timeoutMs;
  
  // ── Save XML to file before sending ─────────────────────────────────────────
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `tally-request-${timestamp}.xml`;
    const logsDir = path.join(process.cwd(), 'logs', 'tally-xml-requests');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const filepath = path.join(logsDir, filename);
    fs.writeFileSync(filepath, xml, 'utf8');
    LOG(`Saved XML request to: ${filepath}`);
  } catch (err) {
    ERR('Failed to save XML to file (non-fatal):', err.message);
  }
  
  LOG(`postXml → ${xml.length} bytes, timeout ${effectiveTimeout}ms${cfg.useConnector ? ' (connector scaled)' : ''}`);
  return postXmlWithRetry(cfg, xml, effectiveTimeout);
}

// ─── RESPONSE PARSER ─────────────────────────────────────────────────────────

function parseResponse(xml, label = '') {
  if (!xml || !xml.trim()) return { ok: false, error: 'Empty response from Tally' };
  const s = String(xml);

  // Always log the complete raw response first — before any parsing.
  LOG(`${label} RAW RESPONSE (full ${s.length} chars):\n${s}`);

  const errors = [];

  // ── Exhaustive diagnostic extraction ──────────────────────────────────────

  // 1. LINEERROR — per-record errors when SVSHOWERRORLIST=Yes is set
  const lineErrors = [];
  for (const m of s.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)) {
    const msg = m[1].trim();
    if (msg) lineErrors.push(msg);
  }
  if (lineErrors.length > 0) {
    ERR(`${label} ── LINEERROR (${lineErrors.length}) ──`);
    lineErrors.forEach((msg, i) => ERR(`${label}   [${i+1}] ${msg}`));
    errors.push(...lineErrors);
  }

  // 2. LASTERROR — Tally's last validation error, set when an exception occurs
  const lastErrors = [];
  for (const m of s.matchAll(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/gi)) {
    const msg = m[1].trim();
    if (msg) lastErrors.push(msg);
  }
  if (lastErrors.length > 0) {
    ERR(`${label} ── LASTERROR (${lastErrors.length}) ──`);
    lastErrors.forEach((msg, i) => ERR(`${label}   [${i+1}] ${msg}`));
    errors.push(...lastErrors);
  }

  // 3. STATUS — numeric status code
  const statusVals = [];
  for (const m of s.matchAll(/<STATUS>([\s\S]*?)<\/STATUS>/gi)) {
    const val = m[1].trim();
    if (val && val !== '1') statusVals.push(val);
  }
  if (statusVals.length > 0) {
    ERR(`${label} ── STATUS values ──`);
    statusVals.forEach((val, i) => ERR(`${label}   [${i+1}] STATUS=${val}`));
  }

  // 4. EXCEPTION blocks
  const exceptionBlocks = [];
  for (const m of s.matchAll(/<EXCEPTION>([\s\S]*?)<\/EXCEPTION>/gi)) {
    const msg = m[1].trim();
    if (msg) exceptionBlocks.push(msg);
  }
  if (exceptionBlocks.length > 0) {
    ERR(`${label} ── EXCEPTION blocks (${exceptionBlocks.length}) ──`);
    exceptionBlocks.forEach((msg, i) => ERR(`${label}   [${i+1}] ${msg}`));
    errors.push(...exceptionBlocks);
  }

  // 5. IMPORTMESSAGE
  const importMsgs = [];
  for (const m of s.matchAll(/<IMPORTMESSAGE>([\s\S]*?)<\/IMPORTMESSAGE>/gi)) {
    const msg = m[1].trim();
    if (msg) importMsgs.push(msg);
  }
  if (importMsgs.length > 0) {
    ERR(`${label} ── IMPORTMESSAGE (${importMsgs.length}) ──`);
    importMsgs.forEach((msg, i) => ERR(`${label}   [${i+1}] ${msg}`));
    errors.push(...importMsgs);
  }

  // 6. Catch-all for other error-like tags
  const unknownDiagPatterns = [/<ERRMSG>([\s\S]*?)<\/ERRMSG>/gi, /<ERRORMESSAGE>([\s\S]*?)<\/ERRORMESSAGE>/gi];
  for (const pattern of unknownDiagPatterns) {
    for (const m of s.matchAll(pattern)) {
      const msg = m[1].trim();
      if (msg) {
        ERR(`${label} ── ERRMSG/ERRORMESSAGE: ${msg}`);
        errors.push(msg);
      }
    }
  }

  // ── Standard IMPORTRESULT counters ────────────────────────────────────────
  const errTag = s.match(/<ERRORS>(\d+)<\/ERRORS>/i);
  const errCount = errTag ? parseInt(errTag[1], 10) : 0;
  if (errCount > 0) {
    const msg = `Tally reported ${errCount} import error(s)`;
    errors.push(msg);
    ERR(`${label} ERRORS count: ${errCount}`);
  }

  const excTag = s.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i);
  const excCount = excTag ? parseInt(excTag[1], 10) : 0;
  if (excCount > 0) {
    ERR(`${label} ── EXCEPTIONS=${excCount} ──`);
    if (lineErrors.length === 0 && lastErrors.length === 0 && exceptionBlocks.length === 0) {
      ERR(`${label} WARNING: EXCEPTIONS=${excCount} but no diagnostic tags found in response.`);
      ERR(`${label} Review the full RAW RESPONSE logged above for clues.`);
    }
    const msg = `Tally EXCEPTIONS=${excCount}${lineErrors.length ? ': ' + lineErrors.join(' | ') : lastErrors.length ? ': ' + lastErrors.join(' | ') : ' — see RAW RESPONSE in logs'}`;
    if (!errors.some(e => e.includes('EXCEPTIONS'))) errors.push(msg);
  }

  const created = parseInt(s.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1] || '0');
  const altered = parseInt(s.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1] || '0');
  const skipped = parseInt(s.match(/<SKIPPED>(\d+)<\/SKIPPED>/i)?.[1] || '0');

  LOG(`${label} → created:${created} altered:${altered} skipped:${skipped} exceptions:${excCount} diagMsgs:${errors.length}`);

  if (errors.length > 0 && created === 0 && altered === 0) {
    return { ok: false, error: errors.join(' | '), created: 0, altered: 0, skipped };
  }
  return {
    ok: true,
    created, altered, skipped,
    warning: errors.length > 0 ? errors.join(' | ') : undefined,
  };
}

// ─── CONNECTION VALIDATION ────────────────────────────────────────────────────

// "List of Companies" report is NOT available in Tally Prime Gold (causes LINEERROR).
// Use a TDL Collection on the Company type instead — works across all Tally editions.
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

/**
 * validateTallyConnection
 * Returns { reachable, openCompany, companyMatch, error }
 * Uses connector routing (if useConnector=true) — same path as postXml.
 * Auto-saves the detected company name to TallyConfig when companyName is not yet set.
 */
export async function validateTallyConnection(cfg) {
  LOG('validateTallyConnection — connector:', cfg.useConnector, 'id:', cfg.connectorId || '(none)');

  try {
    const body = await postXmlWithRetry(cfg, PING_XML, cfg.useConnector && cfg.connectorId ? 90000 : 30000);
    LOG('Ping response:', body.slice(0, 400));

    // TDL Company collection returns <NAME> tags
    const nameMatches = [...body.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim()).filter(Boolean);
    // Also try COMPANYNAME tag as fallback
    const coMatchFallback = body.match(/<COMPANYNAME>(.*?)<\/COMPANYNAME>/i);
    const openCompany = nameMatches[0] || (coMatchFallback ? coMatchFallback[1].trim() : null);

    const expected = (cfg.companyName || '').trim();

    const companyMatch = !expected || !openCompany ||
      openCompany.toLowerCase().replace(/\s+/g, '') === expected.toLowerCase().replace(/\s+/g, '');

    // ── Auto-save detected company name if not yet configured ────────────────
    // This ensures all subsequent exports use the correct SVCURRENTCOMPANY tag.
    const updatePayload = { connectionStatus: 'Connected' };
    if (openCompany && !expected) {
      updatePayload.companyName = openCompany;
      LOG(`Auto-saved companyName from Tally: "${openCompany}"`);
    }
    await TallyConfig.findOneAndUpdate({}, updatePayload, { upsert: true, sort: { _id: 1 } });

    return { reachable: true, openCompany, companyMatch, error: null };

  } catch (err) {
    let error = err.message;
    const code = err.code || '';
    if (code === 'ECONNREFUSED')
      error = `Tally is not running or HTTP Server is disabled. In Tally: F12 → Configure → Advanced → Enable ODBC/HTTP Server: Yes, Port: ${cfg.port || 9000}.`;
    else if (code === 'ECONNRESET' || error.includes('socket hang up'))
      error = `Tally closed the connection unexpectedly. Enable HTTP Server in Tally Prime.`;
    else if (code === 'ETIMEDOUT' || code === 'ECONNABORTED')
      error = `Connection timed out. Check Tally is running and the connector is online.`;
    else if (code === 'ENOTFOUND')
      error = `Cannot reach Tally host. Verify the URL in Settings.`;

    await TallyConfig.findOneAndUpdate({}, { connectionStatus: 'Disconnected' }, { upsert: true });
    return { reachable: false, openCompany: null, companyMatch: false, error };
  }
}

// ─── WRITE SYNC LOG ───────────────────────────────────────────────────────────

async function writeLog({ syncId, type, entity, direction, status, duration, error, records, triggeredBy }) {
  try {
    await TallySyncLog.create({
      syncId, type: type || 'Full', entity: entity || '',
      direction: direction || 'ERP → Tally',
      status, duration: duration || '0s',
      error: error || '', records: records || 0,
      triggeredBy: triggeredBy || null,
    });
  } catch (_) { /* non-fatal */ }
}

// ─── EXPORT TASK: UNITS OF MEASURE ───────────────────────────────────────────

export async function exportUnits(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-UNITS-${Date.now()}`;
  LOG('exportUnits START');
  try {
    // Collect all distinct units used in ItemMaster
    const items    = await ItemMaster.find({ isActive: true }, 'unit').lean();
    const unitSet  = new Set(items.map(i => tallyUnit(i.unit)));
    // Standard Tally units always needed
    ['Nos', 'Kg', 'Ltr', 'Mtr', 'Box', 'Pcs', 'Gm', 'Ml'].forEach(u => unitSet.add(u));

    // ACTION="Create" — Tally silently skips units that already exist (SKIPPED count).
    // Never use "Alter" on UoMs: it can change the symbol on existing items.
    const xml = [...unitSet].map(u => `
<UNIT NAME="${esc(u)}" ACTION="Create">
  <NAME>${esc(u)}</NAME>
  <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
  <FORMALNAME>${esc(u)}</FORMALNAME>
</UNIT>`).join('');

    const resp   = await postXml(cfg, importEnvelope(cfg, 'All Masters', xml), 25000);
    const result = parseResponse(resp, 'Units');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Units', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: unitSet.size, triggeredBy });
    return { ok: result.ok, records: unitSet.size, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportUnits:', err.message);
    await writeLog({ syncId, type: 'Units', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: STOCK GROUPS ────────────────────────────────────────────────

export async function exportStockGroups(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-GROUPS-${Date.now()}`;
  LOG('exportStockGroups START');
  try {
    const categories = await Category.find().lean();

    // ── Stock groups: only create ERP-defined categories.
    // Never alter "Primary" — it is a built-in Tally group and altering it
    // can affect every stock item already in the client's Tally.
    // Use ACTION="Create" for all; Tally skips groups that already exist.
    const categoryXml = categories.map(c => `
<STOCKGROUP NAME="${esc(c.name)}" ACTION="Create">
  <NAME>${esc(c.name)}</NAME>
  <PARENT>Primary</PARENT>
  <ISADDABLE>Yes</ISADDABLE>
</STOCKGROUP>`).join('');

    const xml = categoryXml;  // Do NOT touch the built-in "Primary" group
    const totalRecords = categories.length;

    const resp   = await postXml(cfg, importEnvelope(cfg, 'All Masters', xml), 30000);
    const result = parseResponse(resp, 'Stock Groups');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Item Master', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: totalRecords, triggeredBy });
    return { ok: result.ok, records: totalRecords, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportStockGroups:', err.message);
    await writeLog({ syncId, type: 'Item Master', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: GODOWNS / WAREHOUSES ───────────────────────────────────────

export async function exportGodowns(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-GODOWNS-${Date.now()}`;
  LOG('exportGodowns START');
  try {
    const warehouses = await Warehouse.find({ status: 'Active' }).lean();
    
    // Godowns: ACTION="Create" only — never alter existing godowns in the client's Tally.
    // Tally silently skips godowns that already exist under the same name.
    const mainLocationXml = `
<GODOWN NAME="Main Location" ACTION="Create">
  <NAME>Main Location</NAME>
</GODOWN>`;

    const warehouseXml = warehouses.map(w => `
<GODOWN NAME="${esc(w.name)}" ACTION="Create">
  <NAME>${esc(w.name)}</NAME>
  <PARENT>Main Location</PARENT>
  <ADDRESS.LIST>
    <ADDRESS>${esc(w.address || w.location || '')}</ADDRESS>
  </ADDRESS.LIST>
</GODOWN>`).join('');

    const xml = mainLocationXml + warehouseXml;
    const totalRecords = 1 + warehouses.length;

    const resp   = await postXml(cfg, importEnvelope(cfg, 'All Masters', xml), 30000);
    const result = parseResponse(resp, 'Godowns');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Godowns', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: totalRecords, triggeredBy });
    return { ok: result.ok, records: totalRecords, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportGodowns:', err.message);
    await writeLog({ syncId, type: 'Godowns', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: STOCK ITEMS (Products) + OPENING STOCK ─────────────────────

export async function exportStockItems(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-ITEMS-${Date.now()}`;
  LOG('exportStockItems START');
  try {
    const [items, inventory, categories] = await Promise.all([
      ItemMaster.find({ isActive: true }).populate('category', 'name').lean(),
      Inventory.find({}).lean(),
      Category.find().lean(),
    ]);

    if (!items.length) return { ok: true, records: 0 };

    // Build opening stock map: sku → { qty, rate, warehouseName }
    const openingStockMap = {};
    for (const inv of inventory) {
      const sku = inv.sku;
      if (!openingStockMap[sku]) openingStockMap[sku] = { qty: 0, rate: inv.unitPrice || 0, batches: [] };
      openingStockMap[sku].qty += inv.availableQuantity || 0;
    }

    const xml = items.map(item => {
      const groupName = item.category?.name || '';
      const unit      = tallyUnit(item.unit);
      const openStock = openingStockMap[item.sku];
      const openQty   = openStock?.qty || 0;
      const openRate  = openStock?.rate || item.costPrice || item.unitPrice || 0;
      const gstRate   = item.gst || 0;
      const costPrice = item.costPrice || item.unitPrice || openRate || 0;
      const sellingPrice = item.sellingPrice || item.unitPrice || costPrice || 0;
      // Items that came FROM Tally already have a tallyGuid — use Alter so Tally
      // matches by GUID and updates the record without creating a duplicate.
      // ERP-only items have no tallyGuid — use Create so they are added as new.
      const action = item.tallyGuid ? 'Alter' : 'Create';

      return `
<STOCKITEM NAME="${esc(item.name)}" ACTION="${action}">
  <NAME>${esc(item.name)}</NAME>
  ${groupName ? `<PARENT>${esc(groupName)}</PARENT>` : ''}
  <UNITS>${unit}</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
  <HSNCODE>${esc(item.hsn || '')}</HSNCODE>
  <GSTRATE>${gstRate}</GSTRATE>
  <COSTINGMETHOD>Avg. Cost</COSTINGMETHOD>
  <VALUATIONMETHOD>Avg. Cost</VALUATIONMETHOD>
  <STANDARDCOST>${costPrice.toFixed(2)}</STANDARDCOST>
  <STANDARDPRICE>${sellingPrice.toFixed(2)}</STANDARDPRICE>
  ${item.tallyGuid ? `<GUID>${esc(item.tallyGuid)}</GUID>` : ''}
  ${openQty > 0 ? `
  <OPENINGBALANCE>${openQty} ${unit}</OPENINGBALANCE>
  <OPENINGRATE>${openRate.toFixed(2)} /1 ${unit}</OPENINGRATE>
  <OPENINGVALUE>${(openQty * openRate).toFixed(2)}</OPENINGVALUE>` : ''}
</STOCKITEM>`;
    }).join('');

    const resp   = await postXml(cfg, importEnvelope(cfg, 'All Masters', xml), 45000);
    const result = parseResponse(resp, 'Stock Items');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Item Master', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: items.length, triggeredBy });

    if (result.ok) {
      await ItemMaster.updateMany({ isActive: true }, { tallySynced: true, lastTallySync: new Date() });
    }
    return { ok: result.ok, records: items.length, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportStockItems:', err.message);
    await writeLog({ syncId, type: 'Item Master', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: CUSTOMER LEDGERS ───────────────────────────────────────────

export async function exportCustomerLedgers(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-CUST-${Date.now()}`;
  LOG('exportCustomerLedgers START');
  try {
    const [clients, corporateClients] = await Promise.all([
      Client.find({ status: 'Active' }).lean(),
      CorporateClient.find({ status: 'Active' }).lean(),
    ]);

    const all = [
      ...clients.map(c => ({ name: c.name, gst: c.gstNumber, phone: c.phone, email: c.email, address: c.address, city: c.city, state: c.state, guid: c.tallyGuid })),
      ...corporateClients.map(c => ({ name: c.name, gst: c.gstNumber, phone: c.phone, email: c.email, address: c.address, city: c.city, state: c.state, guid: c.tallyGuid || c.tallyLedgerId })),
    ];

    if (!all.length) return { ok: true, records: 0 };

    // ACTION logic:
    // - Records that came FROM Tally have a tallyGuid → ACTION="Alter" so Tally matches
    //   by GUID and updates safely (e.g. phone/email sync).
    // - ERP-only records have no tallyGuid → ACTION="Create" so they are added as new.
    //   If a ledger with the same name already exists in Tally (and we have no GUID),
    //   Tally will SKIP it — which is the safe behaviour (no overwrite, no data loss).
    const xml = all.map(c => {
      const action = c.guid ? 'Alter' : 'Create';
      return `
<LEDGER NAME="${esc(c.name)}" ACTION="${action}">
  <NAME>${esc(c.name)}</NAME>
  <PARENT>Sundry Debtors</PARENT>
  <ISBILLWISEON>Yes</ISBILLWISEON>
  <GSTREGISTRATIONTYPE>${c.gst ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(c.gst || '')}</PARTYGSTIN>
  <EMAIL>${esc(c.email || '')}</EMAIL>
  <LEDGERMOBILE>${esc(c.phone || '')}</LEDGERMOBILE>
  <MAILINGNAME>${esc(c.name)}</MAILINGNAME>
  <ADDRESS.LIST>
    <ADDRESS>${esc(c.address || '')}</ADDRESS>
    <ADDRESS>${esc([c.city, c.state].filter(Boolean).join(', '))}</ADDRESS>
  </ADDRESS.LIST>
  ${c.guid ? `<GUID>${esc(c.guid)}</GUID>` : ''}
</LEDGER>`;
    }).join('');

    const resp   = await postXml(cfg, importEnvelope(cfg, 'All Masters', xml), 35000);
    const result = parseResponse(resp, 'Customer Ledgers');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Ledger', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: all.length, triggeredBy });
    return { ok: result.ok, records: all.length, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportCustomerLedgers:', err.message);
    await writeLog({ syncId, type: 'Ledger', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: VENDOR/SUPPLIER LEDGERS ────────────────────────────────────

export async function exportVendorLedgers(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-VEND-${Date.now()}`;
  LOG('exportVendorLedgers START');
  try {
    const vendors = await Vendor.find({ status: { $ne: 'Blacklisted' } }).lean();
    if (!vendors.length) return { ok: true, records: 0 };

    // Same ACTION logic as customer ledgers:
    // Tally-origin vendors (have tallyGuid) → Alter by GUID (safe update).
    // ERP-only vendors (no tallyGuid) → Create. Tally skips if name already exists.
    // Never send OPENINGBALANCE on export — it resets the client's balance to 0.
    const xml = vendors.map(v => {
      const action = v.tallyGuid ? 'Alter' : 'Create';
      return `
<LEDGER NAME="${esc(v.companyName)}" ACTION="${action}">
  <NAME>${esc(v.companyName)}</NAME>
  <PARENT>Sundry Creditors</PARENT>
  <ISBILLWISEON>Yes</ISBILLWISEON>
  <GSTREGISTRATIONTYPE>${v.gstNumber ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(v.gstNumber || '')}</PARTYGSTIN>
  <INCOMETAXNUMBER>${esc(v.panNumber || '')}</INCOMETAXNUMBER>
  <EMAIL>${esc(v.email || '')}</EMAIL>
  <LEDGERMOBILE>${esc(v.phone || '')}</LEDGERMOBILE>
  <MAILINGNAME>${esc(v.contactPerson || v.companyName)}</MAILINGNAME>
  <ADDRESS.LIST>
    <ADDRESS>${esc(v.address || '')}</ADDRESS>
    <ADDRESS>${esc([v.city, v.state, v.pincode].filter(Boolean).join(', '))}</ADDRESS>
  </ADDRESS.LIST>
  ${v.tallyGuid ? `<GUID>${esc(v.tallyGuid)}</GUID>` : ''}
</LEDGER>`;
    }).join('');

    const resp   = await postXml(cfg, importEnvelope(cfg, 'All Masters', xml), 35000);
    const result = parseResponse(resp, 'Vendor Ledgers');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Ledger', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: vendors.length, triggeredBy });
    return { ok: result.ok, records: vendors.length, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportVendorLedgers:', err.message);
    await writeLog({ syncId, type: 'Ledger', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: SYSTEM / ACCOUNTS LEDGERS ──────────────────────────────────

export async function exportSystemLedgers(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-SYSLED-${Date.now()}`;
  LOG('exportSystemLedgers START');
  try {
    // ── System / GST ledgers ──────────────────────────────────────────────────
    // CRITICAL: Use ACTION="Create" for all built-in Tally ledgers.
    // These ledgers (CGST, SGST, IGST, Sales Accounts, Purchase Accounts) already
    // exist in every Tally company. Using ACTION="Alter" would overwrite their
    // settings and reset OPENINGBALANCE to 0, destroying the client's data.
    // With ACTION="Create", Tally silently skips records that already exist.
    // Also: never send OPENINGBALANCE on these — it resets the client's balances.
    const systemXml = `
<LEDGER NAME="CGST" ACTION="Create"><NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE><GSTRATE>0</GSTRATE></LEDGER>
<LEDGER NAME="SGST" ACTION="Create"><NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE><GSTRATE>0</GSTRATE></LEDGER>
<LEDGER NAME="IGST" ACTION="Create"><NAME>IGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE><GSTRATE>0</GSTRATE></LEDGER>
<LEDGER NAME="Purchase Accounts" ACTION="Create"><NAME>Purchase Accounts</NAME><PARENT>Purchase Accounts</PARENT></LEDGER>
<LEDGER NAME="Sales Accounts" ACTION="Create"><NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT></LEDGER>
<LEDGER NAME="Freight &amp; Forwarding Charges" ACTION="Create"><NAME>Freight &amp; Forwarding Charges</NAME><PARENT>Indirect Expenses</PARENT></LEDGER>
<LEDGER NAME="Discount Given" ACTION="Create"><NAME>Discount Given</NAME><PARENT>Indirect Expenses</PARENT></LEDGER>
<LEDGER NAME="Discount Received" ACTION="Create"><NAME>Discount Received</NAME><PARENT>Indirect Incomes</PARENT></LEDGER>`;

    // Also export ERP AccountsLedger records
    const acctLedgers = await AccountsLedger.find({ isActive: true }).lean();
    const tallyParent = (g) => {
      const s = (g || '').toLowerCase();
      if (s.includes('creditor')) return 'Sundry Creditors';
      if (s.includes('debtor'))   return 'Sundry Debtors';
      if (s.includes('bank'))     return 'Bank Accounts';
      if (s.includes('cash'))     return 'Cash-in-Hand';
      if (s.includes('expense'))  return 'Indirect Expenses';
      if (s.includes('income'))   return 'Indirect Incomes';
      return 'Sundry Debtors';
    };
    // ERP AccountsLedger records — same ACTION logic:
    // Tally-origin records (have tallyGuid) → Alter by GUID (safe).
    // ERP-only records (no tallyGuid) → Create. Tally skips if name exists.
    // Never send OPENINGBALANCE — it resets the client's balance to 0.
    const acctXml = acctLedgers.map(l => {
      const action = l.tallyGuid ? 'Alter' : 'Create';
      return `
<LEDGER NAME="${esc(l.ledgerName)}" ACTION="${action}">
  <NAME>${esc(l.ledgerName)}</NAME>
  <PARENT>${esc(tallyParent(l.ledgerGroup))}</PARENT>
  <GSTREGISTRATIONTYPE>${l.gstNumber && l.gstNumber !== 'N/A' ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(l.gstNumber && l.gstNumber !== 'N/A' ? l.gstNumber : '')}</PARTYGSTIN>
  ${l.tallyGuid ? `<GUID>${esc(l.tallyGuid)}</GUID>` : ''}
</LEDGER>`;
    }).join('');

    const xml    = systemXml + acctXml;
    const resp   = await postXml(cfg, importEnvelope(cfg, 'All Masters', xml), 90000);
    const result = parseResponse(resp, 'System Ledgers');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    const total  = 7 + acctLedgers.length;
    await writeLog({ syncId, type: 'Ledger', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: total, triggeredBy });

    if (result.ok && acctLedgers.length) {
      await AccountsLedger.updateMany({ isActive: true }, { syncedWithTally: true, lastTallySync: new Date() });
    }
    return { ok: result.ok, records: total, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportSystemLedgers:', err.message);
    await writeLog({ syncId, type: 'Ledger', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── SAFEGUARD: INVOICE NUMBER DEDUP LOOKUP ──────────────────────────────────
// Fetches existing Sales voucher numbers from Tally so we can skip any invoice
// whose invoiceNo already exists as a voucher number in Tally (preventing true
// duplicates where the same invoice number appears twice in the Sales Register).
//
// Returns Set<voucherNumber (uppercase)>
// Non-fatal — if the lookup fails, returns empty Set (export continues normally).
async function fetchTallyExistingVoucherNumbers(cfg) {
  try {
    const company = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim().toUpperCase();
    const coTag   = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
    // Tally Prime EDU crashes on SYSTEM:FORMULA. Fetch all vouchers and
    // filter client-side by VoucherTypeName — works on all Tally editions.
    const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>ERPSalesVoucherNumbers</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="ERPSalesVoucherNumbers">
      <TYPE>Voucher</TYPE>
      <FETCH>VoucherNumber, VoucherTypeName</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

    const resp = await postXmlWithRetry(cfg, xml, (cfg.useConnector && cfg.connectorId) ? 180000 : 30000);
    if (!resp) return new Set();

    const existingNos = new Set();
    const vtypesSeen = new Set(); // diagnostic: log all unique VoucherTypeNames from Tally
    for (const m of resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)) {
      const block = m[1];
      const vtype = (block.match(/<VOUCHERTYPENAME>(.*?)<\/VOUCHERTYPENAME>/i)?.[1] || '').trim().toLowerCase();
      vtypesSeen.add(vtype || '(empty)');
      // Accept "Sales", "Sales Invoice", "Sales Order" — all are Sales-type vouchers in Tally.
      // Some Tally editions / custom voucher types use "Sales Invoice" rather than plain "Sales".
      // Previously filtering only on exact "sales" was causing BIW01-style duplicates where
      // the dedup set missed vouchers and Tally silently returned CREATED=0 for a re-Create.
      if (!vtype.startsWith('sales')) continue;
      const vno = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1] || '').trim().toUpperCase();
      if (vno) existingNos.add(vno);
    }
    LOG(`fetchTallyExistingVoucherNumbers: unique VoucherTypeNames seen in response: [${[...vtypesSeen].join(', ')}]`);
    LOG(`fetchTallyExistingVoucherNumbers: ${existingNos.size} Sales voucher numbers found in Tally`);
    return existingNos;
  } catch (err) {
    ERR('fetchTallyExistingVoucherNumbers failed (non-fatal, skipping dedup check):', err.message);
    return new Set();
  }
}

// ─── SAFEGUARD: PRE-EXPORT VALIDATION ────────────────────────────────────────
// Validates a single invoice before it is sent to Tally.
// Returns { valid: true } if all required fields are present and non-zero,
// or { valid: false, reason: '...' } describing the specific problem.
// A failed validation skips the invoice entirely — nothing is sent to Tally.
function validateInvoiceForExport(inv) {
  if (!inv.invoiceNo || !String(inv.invoiceNo).trim()) {
    return { valid: false, reason: 'Invoice number is missing' };
  }
  if (!inv.partyName || !String(inv.partyName).trim()) {
    return { valid: false, reason: `Invoice ${inv.invoiceNo}: party name is missing` };
  }
  const grandTotal = +(inv.grandTotal || inv.totalAmount || 0);
  if (!grandTotal || grandTotal <= 0) {
    return { valid: false, reason: `Invoice ${inv.invoiceNo}: grand total is zero or missing` };
  }
  return { valid: true };
}

// ─── SAFEGUARD: DETAILED INVOICE EXPORT LOG ──────────────────────────────────
// Writes one TallySyncLog entry per invoice outcome (created / skipped / failed).
// These supplement the summary log written at the end of exportSalesInvoices.
// Logged at type='Sales Invoice' so they appear separately in the Logs tab.
async function logInvoiceExportResult(syncId, invoiceNo, partyName, status, detail) {
  try {
    await TallySyncLog.create({
      syncId,
      type: 'Sales',
      entity: invoiceNo,
      direction: 'ERP → Tally',
      status,                        // 'Success' | 'Skipped' | 'Failed'
      duration: '0s',
      error: status !== 'Success' ? (detail || '') : '',
      records: status === 'Success' ? 1 : 0,
      triggeredBy: null,
    });
  } catch (_) { /* non-fatal — log failure must never abort export */ }
}

// ─── PO NUMBER LOOKUP ────────────────────────────────────────────────────────
// Fetches all Tally vouchers and returns Map<BuyersOrderNo (uppercase) → { guid, voucherNumber }>
// Used by exportSalesInvoices and exportPurchaseInvoices to decide Create vs Alter.
// Uses postXmlWithRetry so it works in both connector mode and direct mode.
async function fetchTallyPOMap(cfg) {
  try {
    const company = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim().toUpperCase();
    const coTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
    const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>ERPVoucherPOLookup</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="ERPVoucherPOLookup">
      <TYPE>Voucher</TYPE>
      <FETCH>GUID, VoucherNumber, VoucherTypeName, BuyersOrderNo</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

    const resp = await postXmlWithRetry(cfg, xml, (cfg.useConnector && cfg.connectorId) ? 180000 : 60000);
    if (!resp) return new Map();

    const byPO = new Map();
    for (const m of resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)) {
      const block         = m[1];
      const guid          = (block.match(/<GUID>(.*?)<\/GUID>/i)?.[1]                  || '').trim();
      const voucherNumber = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1] || '').trim();
      const buyersOrderNo = (block.match(/<BUYERSORDERNO>(.*?)<\/BUYERSORDERNO>/i)?.[1] || '').trim();
      if (guid && buyersOrderNo) {
        byPO.set(buyersOrderNo.toUpperCase().trim(), { guid, voucherNumber });
      }
    }
    LOG(`fetchTallyPOMap: ${byPO.size} vouchers with BuyersOrderNo found in Tally`);
    return byPO;
  } catch (err) {
    ERR('fetchTallyPOMap failed (non-fatal, defaulting to Create):', err.message);
    return new Map();
  }
}

// ─── EXPORT TASK: SALES INVOICES ─────────────────────────────────────────────

// ─── FETCH ACTUAL GST LEDGER NAMES FROM TALLY ────────────────────────────────
// The #1 silent-EXCEPTIONS cause: code guesses "Output CGST @ 9%" but Tally
// has it as "CGST", "Output CGST @9%", or something else entirely.
// This function fetches ALL ledger names from the Duties & Taxes group and
// returns a map so we can resolve the right name for each tax type + rate.
async function fetchTallyGstLedgerNames(cfg) {
  try {
    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag   = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
    // ── Fetch ALL ledgers and filter client-side ──────────────────────────────
    // Using <SYSTEM:FORMULA> with $Parent filter crashes Tally Prime EDU with
    // "TDL Error! Description not found (System Formulae - 'IsDuties')".
    // Fetching all ledgers and filtering by name/TaxType in JS is universally
    // compatible across Tally Prime, Tally Prime EDU, and Tally ERP 9.
    const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>AllLedgers</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="AllLedgers">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent, TaxType</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
    const resp = await postXmlWithRetry(cfg, xml, (cfg.useConnector && cfg.connectorId) ? 90000 : 30000, 1);
    if (!resp) return null;

    // Build arrays of ledger names by tax type — filter client-side
    const cgstNames = [], sgstNames = [], igstNames = [];
    for (const m of resp.matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
      const block    = m[1];
      const name     = (block.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
      const parent   = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim().toLowerCase();
      const taxType  = (block.match(/<TAXTYPE>(.*?)<\/TAXTYPE>/i)?.[1] || '').trim().toLowerCase();
      if (!name) continue;
      const nameLow = name.toLowerCase();
      // Include if: parent is Duties & Taxes, OR TaxType is set, OR name contains gst keyword.
      // Resilient to Tally not returning Parent tag in all collection responses.
      const isDutiesParent = parent.includes('duties') || parent.includes('tax');
      const hasTaxType     = !!taxType;
      const hasGstName     = nameLow.includes('cgst') || nameLow.includes('sgst') || nameLow.includes('igst');
      if (!isDutiesParent && !hasTaxType && !hasGstName) continue;
      if (taxType === 'central tax'    || nameLow.includes('cgst')) cgstNames.push(name);
      if (taxType === 'state tax'      || nameLow.includes('sgst')) sgstNames.push(name);
      if (taxType === 'integrated tax' || nameLow.includes('igst')) igstNames.push(name);
    }
    LOG(`fetchTallyGstLedgerNames: cgst=[${cgstNames.join(', ')}] sgst=[${sgstNames.join(', ')}] igst=[${igstNames.join(', ')}]`);
    return { cgstNames, sgstNames, igstNames };
  } catch (e) {
    ERR('fetchTallyGstLedgerNames failed (non-fatal):', e.message);
    return null;
  }
}

// ─── FETCH SALES LEDGER NAMES FROM TALLY ─────────────────────────────────────
// For GST-enabled inventory vouchers, each stock item must reference the
// EXACT sales ledger name defined in Tally (e.g., "SS Bottle Sales Local 5%").
// This function fetches all ledgers from the "Sales Accounts" group so we can
// build a lookup map: stockItemName → sales ledger name.
async function fetchTallySalesLedgerNames(cfg) {
  try {
    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag   = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
    // Tally Prime EDU crashes on SYSTEM:FORMULA. Fetch all ledgers and
    // filter client-side by Parent — works on all Tally editions.
    const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>SalesLedgers</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="SalesLedgers">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent, TaxType, GSTRate, GSTApplicable</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
    const resp = await postXmlWithRetry(cfg, xml, (cfg.useConnector && cfg.connectorId) ? 90000 : 30000, 1);
    if (!resp) return [];

    const salesLedgers = [];
    for (const m of resp.matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
      const block  = m[1];
      const name   = (block.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
      const parent = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim().toLowerCase();
      // Include only ledgers under Sales Accounts group
      if (!parent.includes('sales')) continue;
      if (name) salesLedgers.push(name);
    }
    LOG(`fetchTallySalesLedgerNames: found ${salesLedgers.length} sales ledgers: [${salesLedgers.slice(0, 10).join(', ')}${salesLedgers.length > 10 ? '...' : ''}]`);
    return salesLedgers;
  } catch (e) {
    ERR('fetchTallySalesLedgerNames failed (non-fatal):', e.message);
    return [];
  }
}

/**
 * Given a list of actual Tally sales ledger names and a stock item name + GST rate,
 * find the best matching sales ledger.
 *
 * Matching priority:
 * 1. Exact match against item.tallySalesLedger (stored per item in ItemMaster)
 * 2. Tally ledger whose name contains a keyword from the item name AND the GST rate
 * 3. Tally ledger whose name contains the GST rate
 * 4. First Tally ledger that is NOT a generic "Sales Accounts"
 * 5. "Sales Accounts" fallback
 */
function resolveSalesLedger(salesLedgers, itemName, itemGSTRate, tallySalesLedger = null, isInterstate = false) {
  // Priority 1: stored exact ledger name from ItemMaster
  if (tallySalesLedger && salesLedgers.includes(tallySalesLedger)) {
    return tallySalesLedger;
  }

  if (!salesLedgers || salesLedgers.length === 0) {
    // No Tally ledgers available — build best-guess name
    if (itemName && itemGSTRate > 0) {
      const baseName = itemName.replace(/\s+\d+ML|\s+\d+L|\s+\d+G$/gi, '').trim();
      return isInterstate 
        ? `${baseName} Sales Interstate` 
        : `${baseName} Sales Local ${itemGSTRate}%`;
    }
    return tallySalesLedger || 'Sales Accounts';
  }

  const gstStr = String(Math.round(itemGSTRate));
  // Build keywords from item name (split by space, take meaningful words)
  const itemWords = (itemName || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);

  // Priority 2: ledger contains item keyword AND gst rate
  for (const ledger of salesLedgers) {
    const low = ledger.toLowerCase();
    const hasRate = low.includes(gstStr + '%') || low.includes(gstStr);
    const hasKeyword = itemWords.some(w => low.includes(w));
    const hasSupplyType = isInterstate ? low.includes('interstate') : (low.includes('local') || !low.includes('interstate'));
    if (hasRate && hasKeyword && hasSupplyType) return ledger;
  }

  // Priority 3: ledger contains item keyword (no rate match)
  for (const ledger of salesLedgers) {
    const low = ledger.toLowerCase();
    const hasKeyword = itemWords.some(w => low.includes(w));
    const hasSupplyType = isInterstate ? low.includes('interstate') : (low.includes('local') || !low.includes('interstate'));
    if (hasKeyword && hasSupplyType) return ledger;
  }

  // Priority 4: any ledger containing the GST rate
  for (const ledger of salesLedgers) {
    const low = ledger.toLowerCase();
    if (low.includes(gstStr + '%') || low.includes(gstStr)) return ledger;
  }

  // Priority 5: first non-generic sales ledger
  const nonGeneric = salesLedgers.find(l => l.toLowerCase() !== 'sales accounts');
  if (nonGeneric) return nonGeneric;

  return 'Sales Accounts';
}

/**
 * Pick the best-matching GST ledger name from a list of actual Tally ledger names.
 * For Sales vouchers, we MUST pick an Output (or plain) ledger — never an Input ledger.
 * Using an Input CGST/SGST/IGST ledger in a Sales voucher causes the cryptic
 * "Voucher date is missing" Tally error.
 *
 * Selection priority:
 *   1. Ledger whose name contains the matching rate AND starts with "Output"
 *   2. Ledger that is an exact plain name (e.g. "CGST", "SGST", "IGST")
 *   3. Any "Output ..." ledger (ignore rate match)
 *   4. Any ledger NOT starting with "Input"
 *   5. First available ledger (last resort)
 */
function pickGstLedger(tallyNames, ratePercent, defaultName) {
  if (!tallyNames || tallyNames.length === 0) return defaultName;
  if (tallyNames.length === 1) return tallyNames[0];

  // Build rate search strings: e.g. ratePercent=2.5 → ["2.5", "2.5%", "2"]
  // This handles both "Output CGST @ 2.5%" and "Output CGST @ 2%" style names.
  const rateFixed   = ratePercent.toFixed(1);                    // "2.5"
  const rateRounded = String(Math.round(ratePercent));            // "3" → avoid, prefer "2.5"
  const rateFloor   = String(Math.floor(ratePercent));            // "2"
  // Prefer exact decimal match, then floor match, then rounded
  const rateTokens  = [...new Set([rateFixed, rateFloor, rateRounded])];

  // Priority 1: Output ledger with matching rate
  for (const token of rateTokens) {
    const match = tallyNames.find(n => {
      const low = n.toLowerCase();
      return low.startsWith('output') && (low.includes(token + '%') || low.includes('@ ' + token));
    });
    if (match) return match;
  }

  // Priority 2: exact plain ledger name (e.g. "CGST", "SGST", "IGST")
  const plain = tallyNames.find(n => n === defaultName);
  if (plain) return plain;

  // Priority 3: any Output ledger (no rate restriction)
  const anyOutput = tallyNames.find(n => n.toLowerCase().startsWith('output'));
  if (anyOutput) return anyOutput;

  // Priority 4: any non-Input ledger
  const nonInput = tallyNames.find(n => !n.toLowerCase().startsWith('input'));
  if (nonInput) return nonInput;

  // Priority 5: fallback to first available
  return tallyNames[0];
}

/** Map tax rate → Tally Output CGST ledger name (static fallback used when live fetch fails) */
function cgstLedgerName(taxableBase, cgstAmt, tallyGstLedgers = null) {
  // When live Tally ledger names are available (direct mode), use them.
  if (tallyGstLedgers?.cgstNames?.length) {
    const r = (taxableBase && cgstAmt) ? +((cgstAmt / taxableBase) * 100).toFixed(2) : 0;
    return pickGstLedger(tallyGstLedgers.cgstNames, r, 'CGST');
  }
  // Fallback: use plain "CGST" — the default ledger name in standard Tally setups.
  // This is also created by the auto-masters step, so it will always exist.
  return 'CGST';
}
function sgstLedgerName(taxableBase, sgstAmt, tallyGstLedgers = null) {
  if (tallyGstLedgers?.sgstNames?.length) {
    const r = (taxableBase && sgstAmt) ? +((sgstAmt / taxableBase) * 100).toFixed(2) : 0;
    return pickGstLedger(tallyGstLedgers.sgstNames, r, 'SGST');
  }
  return 'SGST';
}
function igstLedgerName(taxableBase, igstAmt, tallyGstLedgers = null) {
  if (tallyGstLedgers?.igstNames?.length) {
    const r = (taxableBase && igstAmt) ? +((igstAmt / taxableBase) * 100).toFixed(2) : 0;
    return pickGstLedger(tallyGstLedgers.igstNames, r, 'IGST');
  }
  return 'IGST';
}

// ─── TALLY VOUCHER SERIALIZER ─────────────────────────────────────────────────
/**
 * Pure XML serialization: reads a stored tallyVoucher sub-document and wraps
 * each field in its corresponding XML tag.
 * Zero field mapping, zero amount recomputation.
 * ACTION is determined by Create vs Alter based on PO map lookup (passed in).
 */
function serializeTallyVoucher(tallyVoucher, action = 'Create', guidTag = '') {
  const v = tallyVoucher;

  // ── EXACT format matching manually-created Tally Sales Invoices ───────────
  // Based on visual inspection of SCI0919 (manually created, working):
  //   OBJVIEW="Invoice Voucher View"
  //   LEDGERENTRIES.LIST for party + GST + Sales ledger
  //     Party: ISDEEMEDPOSITIVE=Yes, AMOUNT = NEGATIVE (-grandTotal)
  //     Credits: ISDEEMEDPOSITIVE=No, AMOUNT = POSITIVE (+amount)
  //   ALLINVENTORYENTRIES.LIST for each item
  //     ISDEEMEDPOSITIVE=No, positive amount
  //     ACCOUNTINGALLOCATIONS → Sales Accounts

  // ── Inventory entries ────────────────────────────────────────────────────
  // Fields stored by normalizeToTallyVoucher:
  //   item.rate      → already-formatted string "150.00/Nos"  (written as-is to <RATE>)
  //   item.actualQty → already-formatted string "50 Nos"      (written as-is to <ACTUALQTY>)
  //   item.billedQty → already-formatted string "50 Nos"      (written as-is to <BILLEDQTY>)
  //   item.amount    → negative number  e.g. -7500.00         (abs used for <AMOUNT>)
  //   item.gstHsnName → HSN code string                       (→ <GSTHSNNAME>)
  const inventoryEntriesXml = (v.allInventoryEntries || []).map(item => {
    // rate and qty are pre-formatted strings from the normalizer — use directly
    const rateStr = item.rate || '';           // e.g. "150.00/Nos"
    const actualQtyStr = item.actualQty || ''; // e.g. "50 Nos"
    const billedQtyStr = item.billedQty || ''; // e.g. "50 Nos"
    const amt = Math.abs(item.amount || 0);

    const gstSrcTag = item.gstLedgerSource
      ? `\n    <GSTLEDGERSOURCE>${esc(item.gstLedgerSource)}</GSTLEDGERSOURCE>` : '';

    const ovrdTags = item.gstLedgerSource ? `
    <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
    <GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>` : '';

    // Field name stored by normalizer is gstHsnName (not hsnName)
    const hsnTag = item.gstHsnName ? `\n    <GSTHSNNAME>${esc(item.gstHsnName)}</GSTHSNNAME>` : '';

    const acctAlloc = (item.accountingAllocations || []).map(alloc => `
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>${esc(alloc.ledgerName || '')}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>-${Math.abs(alloc.amount || 0).toFixed(2)}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>`).join('');

    return `
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(item.stockItemName || '')}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>${esc(rateStr)}</RATE>
    <AMOUNT>-${amt.toFixed(2)}</AMOUNT>
    <ACTUALQTY>${esc(actualQtyStr)}</ACTUALQTY>
    <BILLEDQTY>${esc(billedQtyStr)}</BILLEDQTY>${gstSrcTag}${ovrdTags}${hsnTag}${acctAlloc}
  </ALLINVENTORYENTRIES.LIST>`;
  }).join('');
  const hasInventoryEntries = (v.allInventoryEntries || []).length > 0;

  // ── Ledger entries ────────────────────────────────────────────────────────
  // When inventory entries exist, suppress only the pure "Sales Accounts" group entry
  // (the sales credit is already carried in ACCOUNTINGALLOCATIONS inside each
  //  inventory entry). Party and GST ledger entries are always kept.
  const ledgerEntriesXml = (v.allLedgerEntries || []).filter(entry => {
    if (hasInventoryEntries) {
      // Suppress sales credit ledger — it's covered by ACCOUNTINGALLOCATIONS
      const n = (entry.ledgerName || '').toLowerCase();
      const isSalesCredit = n === 'sales accounts'
        || n === 'sales'
        || (n.startsWith('ss ') && n.includes('sales'));
      if (isSalesCredit && !entry.isDeemedPositive) return false;
    }
    return true;
  }).map(entry => {
    const billAllocsXml = (entry.billAllocations || []).map(ba => `
      <BILLALLOCATIONS.LIST>
        <NAME>${esc(ba.name || '')}</NAME>
        <BILLTYPE>${esc(ba.billType || 'New Ref')}</BILLTYPE>
        <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
        <AMOUNT>${(-Math.abs(ba.amount || 0)).toFixed(2)}</AMOUNT>
      </BILLALLOCATIONS.LIST>`).join('');

    const amt = entry.isDeemedPositive
      ? (-Math.abs(entry.amount || 0)).toFixed(2)
      : Math.abs(entry.amount || 0).toFixed(2);

    return `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(entry.ledgerName || '')}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>${entry.isDeemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>${entry.isLastDeemedPositive ? 'Yes' : 'No'}</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>${entry.isDeemedPositive ? 'Yes' : 'No'}</ISPARTYLEDGER>
    <AMOUNT>${amt}</AMOUNT>${billAllocsXml}
  </LEDGERENTRIES.LIST>`;
  }).join('');

  // ── Ship-to address (BASICBASEPARTYDETAILS.LIST) ───────────────────────────
  // These fields are mapped by normalizeToTallyVoucher and stored in the voucher.
  const shipToXml = (v.shipToName || v.shipToAddress) ? `
  <BASICBASEPARTYDETAILS.LIST>
    <BASICBUYERNAME>${esc(v.shipToName || v.partyLedgerName || '')}</BASICBUYERNAME>
    <BASICBUYERADDRESS.LIST>
      <BASICBUYERADDRESS>${esc(v.shipToAddress || '')}</BASICBUYERADDRESS>
    </BASICBUYERADDRESS.LIST>
    <BASICBUYERSTATE>${esc(v.shipToState || '')}</BASICBUYERSTATE>
    <BASICBUYERCOUNTRY>India</BASICBUYERCOUNTRY>
    <BASICBUYERGSTIN>${esc(v.shipToGST || '')}</BASICBUYERGSTIN>
  </BASICBASEPARTYDETAILS.LIST>` : '';

  // ── Bill-to address (ADDRESS.LIST on the party ledger entry) ──────────────
  // Tally stores bill-to as part of the voucher ADDRESS block.
  const billToXml = (v.billToAddress || v.billToName) ? `
  <ADDRESS.LIST>
    <ADDRESS>${esc(v.billToName || '')}</ADDRESS>
    <ADDRESS>${esc(v.billToAddress || '')}</ADDRESS>
    ${v.billToCity  ? `<ADDRESS>${esc(v.billToCity)}</ADDRESS>` : ''}
    ${v.billToState ? `<ADDRESS>${esc(v.billToState)}</ADDRESS>` : ''}
  </ADDRESS.LIST>` : '';

  const poDateXml = v.poDate ? `<BASICORDERDATE>${esc(v.poDate)}</BASICORDERDATE>` : '';

  return `
<VOUCHER VCHTYPE="${esc(v.voucherType || 'Sales')}" ACTION="${action}" OBJVIEW="Invoice Voucher View">
  <DATE>${esc(v.date || '')}</DATE>
  <EFFECTIVEDATE>${esc(v.effectiveDate || v.date || '')}</EFFECTIVEDATE>
  ${guidTag}
  <VOUCHERTYPENAME>${esc(v.voucherType || 'Sales')}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(v.voucherNumber || '')}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(v.partyLedgerName || '')}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <BUYERSORDERNO>${esc(v.buyersOrderNo || '')}</BUYERSORDERNO>
  ${poDateXml}
  <NARRATION>${esc(v.narration || '')}</NARRATION>${billToXml}${shipToXml}${ledgerEntriesXml}${inventoryEntriesXml}
</VOUCHER>`;
}

export async function exportSalesInvoices(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-SALES-${Date.now()}`;
  LOG('exportSalesInvoices START');
  try {
    // ── Step 0: Auto-detect and verify company name from Tally ───────────────
    // The #1 cause of silent EXCEPTIONS with no LINEERROR is a wrong, stale, or
    // empty SVCURRENTCOMPANY tag. In production (Render) the saved companyName can
    // drift from what is actually open in Tally. Re-fetch it before every export run.
    try {
      // Re-read cfg fresh from DB so any manually-corrected companyName is picked up
      const freshCfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
      if (freshCfg) {
        const plain = freshCfg.toObject ? freshCfg.toObject() : freshCfg;
        Object.assign(cfg, plain);
      }

      // Ping Tally — ask which company is currently open
      const pingXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>OpenCompanyList</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="OpenCompanyList" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
      const pingResp = await postXml(cfg, pingXml, 30000);
      const nameMatches = pingResp
        ? [...pingResp.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim()).filter(Boolean)
        : [];
      const detectedCompany = nameMatches[0] || null;
      const savedCompany    = (cfg.companyName || '').trim();

      LOG(`exportSalesInvoices: savedCompany="${savedCompany}" detectedCompany="${detectedCompany || '(not detected)'}"`);

      if (detectedCompany && detectedCompany.toUpperCase() !== savedCompany.toUpperCase()) {
        LOG(`exportSalesInvoices: ⚠️ company name mismatch — correcting "${savedCompany}" → "${detectedCompany}"`);
        cfg.companyName = detectedCompany;
        await TallyConfig.findOneAndUpdate({}, { companyName: detectedCompany }, { sort: { _id: 1 } });
      } else if (detectedCompany && !savedCompany) {
        LOG(`exportSalesInvoices: company name was empty — setting to "${detectedCompany}"`);
        cfg.companyName = detectedCompany;
        await TallyConfig.findOneAndUpdate({}, { companyName: detectedCompany }, { sort: { _id: 1 } });
      }
    } catch (pingErr) {
      LOG(`exportSalesInvoices: company auto-detect failed (non-fatal): ${pingErr.message}`);
    }

    LOG(`exportSalesInvoices: ▶ using SVCURRENTCOMPANY="${cfg.companyName || '(EMPTY — will cause EXCEPTIONS)'}"`);

    // GUARD: If companyName is still empty after the ping, abort immediately.
    // An empty SVCURRENTCOMPANY tag causes every voucher to be silently rejected
    // with EXCEPTIONS=1 and no LINEERROR — the most confusing failure mode.
    if (!cfg.companyName || !cfg.companyName.trim()) {
      ERR('exportSalesInvoices: companyName is empty — cannot export. Open Tally Settings and click "Test Connection" to auto-detect the company name, then retry.');
      return { ok: false, records: 0, error: 'Tally company name is not configured. Go to Tally Settings → Test Connection to auto-detect it, then retry the export.' };
    }

    // ── Step 0.5: Fetch ACTUAL GST ledger names from Tally ────────────────────
    // This prevents the "silent EXCEPTIONS with no LINEERROR" issue caused by
    // referencing a ledger name that doesn't exist in Tally.
    // NOTE: This query is skipped in connector mode (it's a TDL Collection query
    // that times out on slow connectors). In connector mode we rely on the
    // SVSHOWERRORLIST fallback names and log any mismatch from the response.
    // The auto-masters step creates these ledgers if they don't exist anyway.
    let tallyGstLedgers = null;
    let tallySalesLedgers = [];
    if (!(cfg.useConnector && cfg.connectorId)) {
      // Only fetch live ledger names in direct (local) mode — fast enough
      [tallyGstLedgers, tallySalesLedgers] = await Promise.all([
        fetchTallyGstLedgerNames(cfg),
        fetchTallySalesLedgerNames(cfg),
      ]);
      if (!tallyGstLedgers || (!tallyGstLedgers.cgstNames.length && !tallyGstLedgers.sgstNames.length && !tallyGstLedgers.igstNames.length)) {
        LOG('⚠️ exportSalesInvoices: could not fetch GST ledger names from Tally — using fallback names.');
      } else {
        LOG(`exportSalesInvoices: using Tally GST ledgers — cgst:[${tallyGstLedgers.cgstNames.join(', ')}] sgst:[${tallyGstLedgers.sgstNames.join(', ')}]`);
      }
      LOG(`exportSalesInvoices: found ${tallySalesLedgers.length} sales ledgers in Tally`);
    } else {
      LOG('exportSalesInvoices: connector mode — skipping live GST/sales ledger name fetch (using fallback names)');
    }

    // Fetch all ERP invoices that haven't been successfully synced.
    // Also include invoices where tallySync=true but tallySyncAt is null or very old
    // (these were incorrectly marked synced by the old dedup skip path).
    const invoices = await Invoice.find({
      status:    { $nin: ['Cancelled'] },
      source:    { $nin: ['Tally', 'tally'] },
      $or: [
        { tallySync: { $ne: true } },
        // Re-attempt if tallySync=true but was set more than 7 days ago without
        // a corresponding voucher number logged — catches the dedup-skip bug
        { tallySync: true, tallySyncAt: { $exists: false } },
      ],
    }).lean();

    if (!invoices.length) {
      LOG('exportSalesInvoices: 0 pending invoices found — all ERP invoices are already exported (tallySync=true) or originated from Tally. Nothing to send.');
      return { ok: true, records: 0 };
    }

    LOG(`exportSalesInvoices: ${invoices.length} invoices to export`);
    LOG(`First invoice: no=${invoices[0].invoiceNo} source=${invoices[0].source} PO=${invoices[0].buyersOrderNo || 'none'}`);

    // ── Step 1: Auto-create required ledgers & stock items BEFORE vouchers ───
    // Collect unique party names and stock item names from all invoices.
    // ACTION="Create" — Tally silently skips records that already exist.
    const partyNames = [...new Set(invoices.map(inv => inv.partyName).filter(Boolean))];
    const stockNames = [...new Set(
      invoices.flatMap(inv => (inv.items || []).map(i => (i.description || i.name || '').trim())).filter(Boolean)
    )];

    // ── CRITICAL: Auto-create item-specific sales ledgers ─────────────────────
    // GST-enabled vouchers require each stock item to have a dedicated sales ledger.
    // Collect the ACTUAL tallySalesLedger names used in each invoice item —
    // these are the exact names sent in GSTLEDGERSOURCE and must exist in Tally.
    const salesLedgerNames = new Set(['Sales Accounts']);  // fallback always created

    for (const inv of invoices) {
      for (const item of (inv.items || [])) {
        const ledger = (item.tallySalesLedger || '').trim();
        if (ledger && ledger.toLowerCase() !== 'sales accounts') {
          salesLedgerNames.add(ledger);
        }
      }
    }

    // Also add computed names from ItemMaster for items without a stored ledger
    const itemMasters = await ItemMaster.find({ name: { $in: stockNames } }).lean();
    for (const im of itemMasters) {
      if (im.gst > 0) {
        const baseName = im.name.replace(/\d+ML|\d+L|\d+G/gi, '').trim();
        salesLedgerNames.add(`${baseName} Sales Local ${im.gst}%`);
        salesLedgerNames.add(`${baseName} Sales Interstate`);
      }
    }

    const autoLedgerXml = [
      // ── REPAIR: Alter Sales Accounts to remove AFFECTSSTOCK ───────────────
      // A previous export accidentally set AFFECTSSTOCK=Yes on "Sales Accounts".
      // When AFFECTSSTOCK=Yes, Tally rejects any voucher that references it in
      // ACCOUNTINGALLOCATIONS *and* also has ALLINVENTORYENTRIES — silent EXCEPTIONS=1.
      // Fix it now with an explicit Alter so every future export succeeds.
      `<LEDGER NAME="Sales Accounts" ACTION="Alter"><NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT><ISREVENUE>Yes</ISREVENUE><AFFECTSSTOCK>No</AFFECTSSTOCK></LEDGER>`,
      // ── CRITICAL: Create a plain "Sales" ledger as the default sales credit ledger ──
      // normalizeToTallyVoucher uses "Sales" (not "Sales Accounts") as the fallback
      // sales credit ledger in LEDGERENTRIES.LIST when no item-specific ledger is known.
      // "Sales Accounts" is a GROUP — using it in a ledger entry causes EXCEPTIONS=1.
      // This "Sales" ledger is created once and reused for all invoices without a
      // specific per-item sales ledger.
      `<LEDGER NAME="Sales" ACTION="Create"><NAME>Sales</NAME><PARENT>Sales Accounts</PARENT><ISREVENUE>Yes</ISREVENUE><AFFECTSSTOCK>No</AFFECTSSTOCK></LEDGER>`,
      // SAFEGUARD: Create plain CGST/SGST/IGST ledgers WITHOUT rate suffixes first.
      // Most Tally installations (including this client) use plain "CGST"/"SGST"/"IGST"
      // not "Output CGST @ 9%" etc. Creating both ensures vouchers referencing either
      // naming style will find a matching ledger.
      `<LEDGER NAME="CGST" ACTION="Create"><NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="SGST" ACTION="Create"><NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="IGST" ACTION="Create"><NAME>IGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output CGST @ 2.5%" ACTION="Create"><NAME>Output CGST @ 2.5%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output SGST @ 2.5%" ACTION="Create"><NAME>Output SGST @ 2.5%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output CGST @ 6%" ACTION="Create"><NAME>Output CGST @ 6%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output SGST @ 6%" ACTION="Create"><NAME>Output SGST @ 6%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output CGST @ 9%" ACTION="Create"><NAME>Output CGST @ 9%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output SGST @ 9%" ACTION="Create"><NAME>Output SGST @ 9%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output IGST @ 5%" ACTION="Create"><NAME>Output IGST @ 5%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output IGST @ 12%" ACTION="Create"><NAME>Output IGST @ 12%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output IGST @ 18%" ACTION="Create"><NAME>Output IGST @ 18%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      ...partyNames.map(name =>
        `<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>`
      ),
      // ── Item-specific sales ledgers (GST-enabled) ──────────────────────────
      // These are the ACTUAL ledger names as they exist in Tally (or as we compute them).
      // ACTION="Create" — Tally skips any that already exist.
      // Always create every ledger from salesLedgerNames that is NOT already in
      // Tally's live ledger list. The old guard (tallySalesLedgers.length === 0)
      // caused a critical bug: if Tally had ANY sales ledger at all, the block was
      // skipped entirely and new ledgers like "SS Bottle Sales Local 5%" were never
      // created — producing silent EXCEPTIONS=1 on every Item Invoice.
      //
      // CRITICAL: Do NOT set AFFECTSSTOCK=Yes on sales ledgers.
      // AFFECTSSTOCK=Yes tells Tally this ledger moves inventory, which causes
      // EXCEPTIONS=1 (silent) when the voucher ALSO has ALLINVENTORYENTRIES.LIST
      // that already track the stock movement. Double-booking = silent rejection.
      // Pure accounting sales ledgers (AFFECTSSTOCK=No, the default) are correct.
      ...[...salesLedgerNames]
        .filter(name => !tallySalesLedgers.includes(name))
        .map(name =>
          `<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><PARENT>Sales Accounts</PARENT><ISREVENUE>Yes</ISREVENUE></LEDGER>`
        ),
    ].join('');

    const autoStockXml = stockNames.map(name =>
      `<STOCKITEM NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><UNITS>Nos</UNITS></STOCKITEM>`
    ).join('');

    LOG(`Sales: auto-creating ${partyNames.length} party ledgers + ${stockNames.length} stock items before vouchers`);
    LOG(`Sales: party names to create: ${partyNames.slice(0, 5).join(', ')}${partyNames.length > 5 ? ` ... (${partyNames.length - 5} more)` : ''}`);
    const mastersEnvelope = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${autoLedgerXml}${autoStockXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;
    const mastersResp = await postXml(cfg, mastersEnvelope, 60000);
    parseResponse(mastersResp, 'Sales Auto-Masters'); // log result, don't abort

    // ── Fetch existing Tally vouchers indexed by BuyersOrderNo ───────────────
    // PO Number is the ONLY match key. No Party Name / Invoice Number matching.
    const tallyPOMap = await fetchTallyPOMap(cfg);
    LOG(`exportSalesInvoices: ${tallyPOMap.size} PO numbers already in Tally`);

    // ── SAFEGUARD: Fetch existing Sales voucher numbers from Tally ────────────
    // If an invoice number already exists as a Sales voucher number in Tally,
    // it means this invoice was already exported (possibly via a different path
    // or with tallySync cleared). Skip and report it rather than creating a duplicate.
    const tallyVoucherNumbers = await fetchTallyExistingVoucherNumbers(cfg);
    LOG(`exportSalesInvoices: ${tallyVoucherNumbers.size} existing Sales voucher numbers in Tally`);

    // ── Fetch Tally company period end to cap voucher dates ───────────────────
    // Tally rejects vouchers dated after the company's ENDINGAT date with the
    // MISLEADING "Voucher date is missing" error (even when <DATE> is present).
    // Cap all dates to period end.
    let periodEnd = await fetchTallyPeriodEnd(cfg);
    if (!periodEnd) {
      // Fallback: use a cached value from TallyConfig if available.
      // Do NOT fall back to "yesterday" — that silently caps all invoice dates
      // to the wrong date and causes EXCEPTIONS=1 with no LINEERROR in Tally.
      // Better to send the actual invoice date and let Tally reject explicitly
      // (it will then show a LINEERROR we can read) than silently cap to a wrong date.
      const saved = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
      const cachedPeriodEnd = saved?.tallyPeriodEnd;
      // Guard against a stale "yesterday" cached value (written by the old fallback logic).
      // A valid Tally period end is always a financial year end:
      //   March 31 (MMDD=0331) or sometimes Sep 30 (0930).
      // Any cached value that is within the last 30 days is almost certainly wrong.
      const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = `${thirtyDaysAgo.getFullYear()}${String(thirtyDaysAgo.getMonth()+1).padStart(2,'0')}${String(thirtyDaysAgo.getDate()).padStart(2,'0')}`;
      if (cachedPeriodEnd && cachedPeriodEnd < thirtyDaysAgoStr) {
        // Value is more than 30 days ago — could be a stale financial-year-end or wrong "yesterday" value
        // Only use it if it looks like a genuine FY end (MMDD = 0331 or 0930 or 1231)
        const mmdd = cachedPeriodEnd.slice(4); // MMDD portion
        if (mmdd === '0331' || mmdd === '0930' || mmdd === '1231') {
          periodEnd = cachedPeriodEnd;
          LOG(`exportSalesInvoices: using cached periodEnd from DB: ${periodEnd}`);
        } else {
          // Looks like a wrong "yesterday"-style cached value — clear it and don't cap
          LOG(`exportSalesInvoices: cached tallyPeriodEnd "${cachedPeriodEnd}" looks stale/wrong (not a FY end) — clearing and using actual invoice dates`);
          await TallyConfig.findOneAndUpdate({}, { $unset: { tallyPeriodEnd: 1 } }, { sort: { _id: 1 } });
          periodEnd = null;
        }
      } else if (cachedPeriodEnd) {
        periodEnd = cachedPeriodEnd;
        LOG(`exportSalesInvoices: using cached periodEnd from DB: ${periodEnd}`);
      } else {
        periodEnd = null; // No capping — use actual invoice dates
        LOG(`exportSalesInvoices: ⚠ periodEnd unknown — sending actual invoice dates (no capping). If Tally rejects, open Tally Settings → Test Connection to cache the period end.`);
      }
    } else {
      // Cache the period end in TallyConfig for fallback use
      await TallyConfig.findOneAndUpdate({}, { tallyPeriodEnd: periodEnd }, { sort: { _id: 1 } });
    }
    LOG(`exportSalesInvoices: voucher dates will be capped to ${periodEnd || '(none — actual dates will be used)'}`);

    const failedItems  = [];
    const skippedItems = [];   // invoices skipped due to validation failure or dedup
    const vouchersXml = [];    // populated below after safeguard checks

    for (let idx = 0; idx < invoices.length; idx++) {
      const inv = invoices[idx];
      try {
        // ── SAFEGUARD 1: Pre-export validation ──────────────────────────────
        // Reject invoices with missing or zero critical fields before building
        // XML. A bad invoice must never reach Tally — not even partially.
        const validation = validateInvoiceForExport(inv);
        if (!validation.valid) {
          LOG(`Invoice ${inv.invoiceNo}: SKIPPED — validation failed: ${validation.reason}`);
          failedItems.push({ id: inv.invoiceNo, error: `Validation: ${validation.reason}` });
          await logInvoiceExportResult(syncId, inv.invoiceNo || '?', inv.partyName || '?', 'Failed', `Validation failed: ${validation.reason}`);
          continue;
        }

        // ── SAFEGUARD 2: Invoice-number dedup check against Tally ───────────
        // If the invoice number already exists in Tally, we must ALTER (not Create)
        // to overwrite it with the ERP version. ERP is the source of truth.
        // We do NOT skip and mark synced — that would leave a manually-created
        // Tally voucher permanently replacing the ERP voucher.
        const invNoUpper = String(inv.invoiceNo).trim().toUpperCase();
        if (idx < 5) {
          LOG(`DEDUP CHECK invoice[${idx}] "${invNoUpper}" — already in Tally: ${tallyVoucherNumbers.has(invNoUpper)} (set size: ${tallyVoucherNumbers.size})`);
        }
        // Flag for Alter — will be used below when serializeTallyVoucher is called
        const existsInTally = tallyVoucherNumbers.has(invNoUpper);
        if (existsInTally) {
          LOG(`Invoice ${inv.invoiceNo}: already in Tally — will send as Alter to sync ERP version`);
        }

        // ── Voucher date helpers (used by both primary and fallback paths) ─
        const freshToday = (() => {
          const n = new Date();
          return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
        })();
        const origDateFmt = inv.invoiceDate
          ? new Date(inv.invoiceDate).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })
          : '';

        // ── PRIMARY PATH: always re-normalize from live invoice data ──────
        // The stored tallyVoucher may be stale (built before ItemMaster had
        // tallySalesLedger, or before serializer bugs were fixed). Re-normalize
        // fresh every time so we always send correct XML.
        let voucherXml;

        if (inv.tallyVoucher && inv.tallyVoucher.voucherNumber) {
          // Fetch fresh ItemMaster data for all items in this invoice
          const itemNames = [...new Set(
            (inv.items || []).map(i => (i.description || i.name || '').trim()).filter(Boolean)
          )];
          const masters = itemNames.length
            ? await ItemMaster.find({ name: { $in: itemNames } }, 'name hsn tallySalesLedger').lean()
            : [];
          const masterMap = new Map(masters.map(m => [m.name, m]));

          // Enrich invoice items with latest ItemMaster values
          const enrichedItems = (inv.items || []).map(item => {
            const n  = (item.description || item.name || '').trim();
            const im = masterMap.get(n);
            return {
              ...item,
              hsn:              (item.hsn || '').trim()              || (im?.hsn              || '').trim(),
              tallySalesLedger: (item.tallySalesLedger || '').trim() || (im?.tallySalesLedger || '').trim(),
            };
          });

          // Re-normalize with fresh data + current periodEnd
          let tv;
          try {
            tv = normalizeToTallyVoucher(
              { ...inv, items: enrichedItems },
              { periodEnd }
            );
          } catch (reNormErr) {
            ERR(`Invoice ${inv.invoiceNo}: re-normalization failed: ${reNormErr.message}`);
            failedItems.push({ id: inv.invoiceNo, error: `Re-normalize: ${reNormErr.message}` });
            await logInvoiceExportResult(syncId, inv.invoiceNo, inv.partyName || '', 'Failed', reNormErr.message);
            continue;
          }

          const poNumber     = (tv.buyersOrderNo || inv.buyersOrderNo || '').toUpperCase().trim();
          const existingByPO = poNumber ? tallyPOMap.get(poNumber) : null;
          // Force Alter if: PO map found it, or ERP has a GUID, or dedup set found the voucher number
          const action       = (existingByPO || inv.tallyGuid || existsInTally) ? 'Alter' : 'Create';
          const guidTag      = existingByPO?.guid ? `<GUID>${esc(existingByPO.guid)}</GUID>`
                             : inv.tallyGuid      ? `<GUID>${esc(inv.tallyGuid)}</GUID>` : '';

          const hasInventory    = (tv.allInventoryEntries || []).length > 0;
          const salesLedgerUsed = hasInventory
            ? (tv.allInventoryEntries[0]?.accountingAllocations?.[0]?.ledgerName || 'Sales Accounts')
            : (tv.allLedgerEntries?.find(e => !e.isDeemedPositive && !e.ledgerName?.toLowerCase().includes('cgst') && !e.ledgerName?.toLowerCase().includes('sgst') && !e.ledgerName?.toLowerCase().includes('igst'))?.ledgerName || 'Sales');
          LOG(`Invoice ${inv.invoiceNo}: action=${action} date=${tv.date} inventoryEntries=${hasInventory ? tv.allInventoryEntries.length : 0} salesLedger="${salesLedgerUsed}"`);

          voucherXml = serializeTallyVoucher(tv, action, guidTag);

        } else {
          // ── FALLBACK: legacy field-mapping path ─────────────────────────
          LOG(`Invoice ${inv.invoiceNo}: FALLBACK path — tallyVoucher=null, using legacy mapper`);
          await logInvoiceExportResult(syncId, inv.invoiceNo, inv.partyName || '', 'Warning',
            'tallyVoucher missing — used legacy mapper. Run: node scripts/migrate-tally-vouchers.js');

          // ── Match by PO Number or voucher number ──────────────────────────
          const poNumber = (inv.buyersOrderNo || '').toUpperCase().trim();
          const existing = poNumber ? tallyPOMap.get(poNumber) : null;
          const action   = (existing || existsInTally) ? 'Alter' : 'Create';
          const guidTag  = existing ? `<GUID>${esc(existing.guid)}</GUID>` : '';
          LOG(`Invoice ${inv.invoiceNo} (PO: ${poNumber || 'none'}): ${action}${existsInTally ? ' (voucher exists in Tally)' : ''}`);

          const tallyDate = capTallyDate(
            action === 'Alter' ? (td(inv.invoiceDate) || freshToday) : freshToday,
            periodEnd
          );

        // ── Amounts ────────────────────────────────────────────────────────
          const grandTotal  = +(inv.grandTotal || inv.totalAmount || 0).toFixed(2);
          const totalCGST   = +(inv.cgstTotal  ?? (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0)).toFixed(2);
          const totalSGST   = +(inv.sgstTotal  ?? (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0)).toFixed(2);
          const totalIGST   = +(inv.igstTotal  ?? (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0)).toFixed(2);
          const totalTax    = +(totalCGST + totalSGST + totalIGST).toFixed(2);
          const salesBase   = +(grandTotal - totalTax).toFixed(2);

          const cgstEntry = totalCGST > 0 ? `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(cgstLedgerName(salesBase, totalCGST, tallyGstLedgers))}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${totalCGST.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : '';

          const sgstEntry = totalSGST > 0 ? `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(sgstLedgerName(salesBase, totalSGST, tallyGstLedgers))}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${totalSGST.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : '';

          const igstEntry = totalIGST > 0 ? `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(igstLedgerName(salesBase, totalIGST, tallyGstLedgers))}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${totalIGST.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : '';

          // ── Sales credit ledger for the legacy fallback path ──────────────
          // "Sales Accounts" is a Tally GROUP, not a ledger — must NOT be used
          // in LEDGERENTRIES.LIST (causes EXCEPTIONS=1).
          // Use the item-specific tallySalesLedger if one is set, else "Sales"
          // (the auto-created fallback ledger under "Sales Accounts" group).
          const legacyItemLedgers = (inv.items || [])
            .map(i => (i.tallySalesLedger || '').trim())
            .filter(l => l && l.toLowerCase() !== 'sales accounts');
          const legacySalesLedger = legacyItemLedgers.length > 0 ? legacyItemLedgers[0] : 'Sales';

          const salesAccEntry = `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(legacySalesLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${(totalTax > 0 ? salesBase : grandTotal).toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>`;

          const legacyPoRef = (inv.buyersOrderNo || inv.purchaseOrderRef || '').trim();

          // ── Inventory entries ─────────────────────────────────────────────
          // Only build ALLINVENTORYENTRIES.LIST when we have a real sales ledger per item.
          // The legacy fallback has no per-item ledger names, so all items would fall
          // back to "Sales Accounts" in ACCOUNTINGALLOCATIONS — which Tally rejects
          // (it's a group, not a ledger). Use pure-accounting format in that case.
          // Items get into Tally as line items only when item.tallySalesLedger is set.
          const rawItems = (inv.items || []).filter(item => (item.description || item.name || '').trim());
          const itemAmounts = rawItems.map(item => {
            const qty  = +(item.qty || 1);
            const rate = +(item.rate || 0);
            return +(item.amount || item.basic || (qty * rate)).toFixed(2);
          });
          const itemsTotal = +itemAmounts.reduce((s, a) => s + a, 0).toFixed(2);
          const useInventory = rawItems.length > 0 && Math.abs(itemsTotal - salesBase) <= 0.10
            && rawItems.some(i => {
              const l = (i.tallySalesLedger || '').trim().toLowerCase();
              return l && l !== 'sales accounts';
            });

          let legacyAllocated = 0;
          const inventoryEntries = useInventory ? rawItems.map((item, i) => {
            const itemName   = (item.description || item.name || '').trim();
            const itemQty    = +(item.qty || 1);
            const itemRate   = +(item.rate || 0);
            const isLast     = i === rawItems.length - 1;
            const itemAmt    = isLast
              ? +(salesBase - legacyAllocated).toFixed(2)
              : itemAmounts[i];
            legacyAllocated  = +(legacyAllocated + (isLast ? itemAmt : itemAmounts[i])).toFixed(2);
            // Sales inventory: ISDEEMEDPOSITIVE=No → amounts must be NEGATIVE
            const negItemAmt = -Math.abs(itemAmt);
            const itemUnit   = 'Nos';
            const salesLedger = (item.tallySalesLedger || '').trim();
            return `
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(itemName)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>${itemRate.toFixed(2)}/${itemUnit}</RATE>
    <AMOUNT>${negItemAmt.toFixed(2)}</AMOUNT>
    <ACTUALQTY>${itemQty} ${itemUnit}</ACTUALQTY>
    <BILLEDQTY>${itemQty} ${itemUnit}</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>${esc(salesLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>${negItemAmt.toFixed(2)}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>`;
          }).join('') : '';
          const hasLegacyInventory = useInventory && rawItems.length > 0;

          // Narration: comprehensive item breakdown (Tally config blocks inventory XML)
          const itemLines = rawItems.map((item, i) => {
            const itemName = (item.description || item.name || '').trim();
            const itemQty  = +(item.qty || 1);
            const itemRate = +(item.rate || 0);
            const itemAmt  = itemAmounts[i] || 0;
            const itemUnit = tallyUnit(item.unit || 'Nos');
            return `${i + 1}. ${itemName}: ${itemQty} ${itemUnit} @ ₹${itemRate.toFixed(2)} = ₹${itemAmt.toFixed(2)}`;
          });
          const narration = [
            `Invoice: ${inv.invoiceNo}`,
            origDateFmt ? `Date: ${origDateFmt}` : null,
            legacyPoRef ? `PO: ${legacyPoRef}` : null,
            '',
            ...itemLines,
            '',
            inv.notes || null,
          ].filter(x => x !== null).join('\n');

          LOG(`Invoice ${inv.invoiceNo}: partyName="${inv.partyName}" tallyDate=${tallyDate} grandTotal=${grandTotal} cgst=${totalCGST} sgst=${totalSGST} igst=${totalIGST}`);

          // Balance check
          const creditTotal = +(totalCGST + totalSGST + totalIGST + (totalTax > 0 ? salesBase : grandTotal)).toFixed(2);
          if (Math.abs(grandTotal - creditTotal) > 0.01) {
            const reason = `Voucher imbalanced: debit=${grandTotal} credits=${creditTotal}`;
            ERR(`Invoice ${inv.invoiceNo}: SKIPPED — ${reason}`);
            failedItems.push({ id: inv.invoiceNo, error: reason });
            await logInvoiceExportResult(syncId, inv.invoiceNo || '?', inv.partyName || '?', 'Failed', reason);
            continue;
          }

          const billName  = (inv.billToName || inv.billToMailingName || inv.partyName || '').trim();
          const billAddr  = (inv.billToAddress || inv.partyAddress || '').trim();
          const billCity  = (inv.billToCity || inv.partyCity || '').trim();
          const billState = (inv.billToState || inv.partyState || '').trim();
          const billGST   = (inv.billToGST || inv.partyGST || '').trim();
          const shipName  = (inv.shipToName || inv.shipToMailingName || '').trim();
          const shipAddr  = (inv.shipToAddress || '').trim();
          const shipCity  = (inv.shipToCity  || '').trim();
          const shipState = (inv.shipToState || '').trim();
          const shipGST   = (inv.shipToGST   || '').trim();

          const hasLegacyShipTo = !!(shipName || shipAddr);
          // Address tags removed pending confirmed-working test — same as serializeTallyVoucher.
          const billToXml = '';
          const shipToXml = '';

          voucherXml = `
<VOUCHER VCHTYPE="Sales" ACTION="${action}" OBJVIEW="Invoice Voucher View">
  <DATE>${tallyDate}</DATE>
  <EFFECTIVEDATE>${tallyDate}</EFFECTIVEDATE>
  ${guidTag}
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(inv.invoiceNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(inv.partyName)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <BUYERSORDERNO>${esc(inv.buyersOrderNo || inv.purchaseOrderRef || '')}</BUYERSORDERNO>
  ${inv.poDate || inv.orderDate ? `<BASICORDERDATE>${esc(td(inv.poDate || inv.orderDate))}</BASICORDERDATE>` : ''}
  <NARRATION>${esc(narration)}</NARRATION>
  ${billToXml}
  ${shipToXml}
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(inv.partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(inv.invoiceNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </LEDGERENTRIES.LIST>
  ${cgstEntry}${sgstEntry}${igstEntry}${hasLegacyInventory ? '' : salesAccEntry}${inventoryEntries}
</VOUCHER>`;
        } // end fallback (legacy mapper)

        if (idx === 0) LOG(`exportSalesInvoices: FIRST INVOICE XML:\n${voucherXml}`);
        vouchersXml.push({ id: inv._id, invoiceNo: inv.invoiceNo, partyName: inv.partyName || '', xml: voucherXml });
      } catch (e) {
        failedItems.push({ id: inv.invoiceNo, error: e.message });
        await logInvoiceExportResult(syncId, inv.invoiceNo || '?', inv.partyName || '?', 'Failed', `Build error: ${e.message}`);
      }
    }

    // ── Send ONE voucher per request ─────────────────────────────────────
    // Sending individually ensures:
    //  1. No Tally payload size limit issues (was causing "Voucher date missing")
    //  2. Each invoice appears clearly in Tally Sales Register
    //  3. One failure doesn't block other invoices
    const BATCH_SIZE  = 1;
    let   totalCreated = 0, totalAltered = 0;
    const batchErrors  = [];
    const successIds   = [];

    for (let b = 0; b < vouchersXml.length; b += BATCH_SIZE) {
      const batch    = vouchersXml.slice(b, b + BATCH_SIZE);
      const batchNo  = Math.floor(b / BATCH_SIZE) + 1;
      const batchTot = Math.ceil(vouchersXml.length / BATCH_SIZE);
      LOG(`Sales batch ${batchNo}/${batchTot} — ${batch.length} vouchers`);

      const singleEnvelope = importEnvelope(cfg, 'Vouchers', batch.map(v=>v.xml).join(''));
      if (b === 0) {
        // Log full XML of first voucher — shows SVCURRENTCOMPANY, party name, amounts
        // This is the single most useful diagnostic for production EXCEPTIONS issues
        LOG(`Sales DEBUG — first batch full XML (company=${cfg.companyName || 'EMPTY'}):\n${singleEnvelope}`);
      }
      const resp   = await postXml(cfg, singleEnvelope, 60000);
      const result = parseResponse(resp, `Sales Invoices batch ${batchNo}/${batchTot}`);

      // If this batch gets EXCEPTIONS=1 and it's not the first (already logged), log the XML too
      // so we can diagnose which invoice is different. Only log on first failure to avoid log spam.
      if (!result.ok && b > 0 && batchErrors.length === 0) {
        LOG(`Sales DEBUG — first FAILING batch (${batchNo}/${batchTot}) full XML:\n${singleEnvelope}`);
      }

      // ── SAFEGUARD: Detect "silent duplicate" — Tally returns all-zero when
      // ACTION="Create" is sent for a voucher number that already exists in Tally.
      // CREATED=0, ALTERED=0, ERRORS=0, EXCEPTIONS=0 with a single voucher means
      // Tally knows this number but we sent Create instead of Alter.
      // Also handles EXCEPTIONS=1 with CREATED=0 — this happens when an existing
      // voucher has a different structure (e.g. accounting-only vs item invoice)
      // and Tally rejects the Create. Re-send as Alter to overwrite it.
      const isSilentDuplicate = result.ok && (result.created || 0) === 0 && (result.altered || 0) === 0 && batch.length === 1;
      const isExceptionOnCreate = !result.ok && (result.created || 0) === 0 && batch.length === 1;
      if (isSilentDuplicate || isExceptionOnCreate) {
        const v = batch[0];
        const reason = isSilentDuplicate ? 'CREATED=0, ALTERED=0 — voucher already exists in Tally' : 'EXCEPTIONS=1 on Create — voucher may exist with different structure';
        LOG(`Sales batch ${batchNo}: ${reason}. Re-sending ${v.invoiceNo} as Alter...`);
        // Rebuild the XML with ACTION="Alter" by string-replacing the action attribute
        const alterXml = v.xml.replace(/ACTION="Create"/, 'ACTION="Alter"');
        const alterEnvelope = importEnvelope(cfg, 'Vouchers', alterXml);
        const alterResp   = await postXml(cfg, alterEnvelope, 60000);
        const alterResult = parseResponse(alterResp, `Sales Invoices batch ${batchNo}/${batchTot} [Alter retry]`);
        if (alterResult.ok) {
          totalCreated += alterResult.created || 0;
          totalAltered += alterResult.altered || 0;
          LOG(`Sales batch ${batchNo}: Alter retry succeeded — created:${alterResult.created} altered:${alterResult.altered}`);
          successIds.push(v.id);
          await logInvoiceExportResult(syncId, v.invoiceNo, v.partyName, 'Success', 'Sent as Alter (was duplicate Create)');
          // Also mark this number in the local set to prevent a repeated attempt
          tallyVoucherNumbers.add(String(v.invoiceNo).trim().toUpperCase());
        } else {
          // ── LAST RESORT: Delete + Re-Create ──────────────────────────────
          // The Alter was also rejected — this typically happens when the existing
          // Tally voucher has a different structure (e.g. item invoice vs accounting)
          // and Tally won't allow structural changes via Alter.
          // Delete the existing voucher and re-create it fresh.
          LOG(`Sales batch ${batchNo}: Alter also rejected — attempting Delete + Create for ${v.invoiceNo}`);
          try {
            const deleteXml = v.xml.replace(/ACTION="(Create|Alter)"/, 'ACTION="Delete"');
            const deleteEnvelope = importEnvelope(cfg, 'Vouchers', deleteXml);
            const deleteResp = await postXml(cfg, deleteEnvelope, 60000);
            const deleteResult = parseResponse(deleteResp, `Sales batch ${batchNo} [Delete]`);
            LOG(`Sales batch ${batchNo}: Delete result — ok:${deleteResult.ok} altered:${deleteResult.altered}`);

            // Re-create fresh (Create action, no GUID)
            const reCreateXml = v.xml
              .replace(/ACTION="(Alter|Delete)"/, 'ACTION="Create"')
              .replace(/<GUID>[^<]*<\/GUID>\s*/gi, ''); // strip any GUID tag
            const reCreateEnvelope = importEnvelope(cfg, 'Vouchers', reCreateXml);
            const reCreateResp = await postXml(cfg, reCreateEnvelope, 60000);
            const reCreateResult = parseResponse(reCreateResp, `Sales batch ${batchNo} [Delete+Create]`);

            if (reCreateResult.ok && (reCreateResult.created || 0) > 0) {
              totalCreated += reCreateResult.created || 0;
              LOG(`Sales batch ${batchNo}: Delete+Create succeeded — ${v.invoiceNo} re-created in Tally`);
              successIds.push(v.id);
              await logInvoiceExportResult(syncId, v.invoiceNo, v.partyName, 'Success', 'Re-created after Delete (structure conflict resolved)');
              tallyVoucherNumbers.add(String(v.invoiceNo).trim().toUpperCase());
            } else {
              const finalErr = reCreateResult.error || 'Tally rejected Delete+Create';
              batchErrors.push(`Batch ${batchNo}: ${finalErr}`);
              await logInvoiceExportResult(syncId, v.invoiceNo, v.partyName, 'Failed', `Delete+Create failed: ${finalErr}`);
            }
          } catch (delErr) {
            ERR(`Sales batch ${batchNo}: Delete+Create threw: ${delErr.message}`);
            batchErrors.push(`Batch ${batchNo}: ${alterResult.error}`);
            for (const bv of batch) {
              await logInvoiceExportResult(syncId, bv.invoiceNo, bv.partyName, 'Failed', alterResult.error || 'Tally rejected Alter retry');
            }
          }
        }
        continue;
      }

      if (result.ok) {
        totalCreated += result.created || 0;
        totalAltered += result.altered || 0;
        // ── SAFEGUARD 3: Per-invoice export log (created/success) ──────────
        for (const v of batch) {
          successIds.push(v.id);
          await logInvoiceExportResult(syncId, v.invoiceNo, v.partyName, 'Success', null);
        }
      } else {
        batchErrors.push(`Batch ${batchNo}: ${result.error}`);
        // ── SAFEGUARD 3: Per-invoice export log (failed) ───────────────────
        for (const v of batch) {
          await logInvoiceExportResult(syncId, v.invoiceNo, v.partyName, 'Failed', result.error || 'Tally rejected');
        }
      }
    }

    // Mark only successfully exported invoices as synced
    if (successIds.length > 0) {
      await Invoice.updateMany({ _id: { $in: successIds } }, { tallySync: true, tallySyncAt: new Date() });
    }

    const overallOk = batchErrors.length === 0;
    const dur = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Sales', direction: 'ERP → Tally', status: overallOk ? 'Success' : 'Failed', duration: dur, error: batchErrors.join('; '), records: invoices.length, triggeredBy });

    LOG(`exportSalesInvoices complete — created:${successIds.length} skipped:${skippedItems.length} failed:${failedItems.length} batchErrors:${batchErrors.length} in ${dur}`);
    return {
      ok: overallOk,
      records: invoices.length,
      created: totalCreated,
      altered: totalAltered,
      skipped: skippedItems.length,
      error: batchErrors.length ? batchErrors.join('; ') : undefined,
      failedItems,
      skippedItems,
    };
  } catch (err) {
    ERR('exportSalesInvoices:', err.message);
    await writeLog({ syncId, type: 'Sales', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: PURCHASE INVOICES (from POs) ───────────────────────────────

export async function exportPurchaseInvoices(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-PUR-${Date.now()}`;
  LOG('exportPurchaseInvoices START');
  try {
    // Export all ERP-created POs. Skip only Tally-origin ones.
    // PO number matching handles create vs update — no tallySync filter needed.
    const pos = await PurchaseOrder.find({
      status: { $in: ['Approved', 'Received'] },
      dataSource: { $ne: 'Tally' },
    }).populate('vendor').lean();

    if (!pos.length) return { ok: true, records: 0 };

    // ── Step 1: Auto-create required ledgers & stock items BEFORE vouchers ───
    // ACTION="Create" — Tally silently skips records that already exist.
    // Collect vendor names: from populated reference OR parsed from remarks
    const vendorNames = [...new Set(pos.map(po => {
      if (po.vendor?.companyName) return po.vendor.companyName;
      const m = (po.remarks || '').match(/—\s*(.+?)(?:'s\s+quotation)?$/i);
      return m ? m[1].trim() : null;
    }).filter(Boolean))];
    const poStockNames = [...new Set(
      pos.flatMap(po => (po.items || []).map(i => (i.name || '').trim())).filter(Boolean)
    )];

    const purAutoLedgerXml = [
      `<LEDGER NAME="Purchase Accounts" ACTION="Create"><NAME>Purchase Accounts</NAME><PARENT>Purchase Accounts</PARENT></LEDGER>`,
      `<LEDGER NAME="CGST" ACTION="Create"><NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="SGST" ACTION="Create"><NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="IGST" ACTION="Create"><NAME>IGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      ...vendorNames.map(name =>
        `<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>`
      ),
    ].join('');

    const purAutoStockXml = poStockNames.map(name =>
      `<STOCKITEM NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><UNITS>Nos</UNITS></STOCKITEM>`
    ).join('');

    LOG(`Purchase: auto-creating ${vendorNames.length} vendor ledgers + ${poStockNames.length} stock items before vouchers`);
    const purMastersEnvelope = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${purAutoLedgerXml}${purAutoStockXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;
    const purMastersResp = await postXml(cfg, purMastersEnvelope, 60000);
    parseResponse(purMastersResp, 'Purchase Auto-Masters'); // log result, don't abort

    // ── Fetch existing Tally vouchers indexed by BuyersOrderNo ───────────────
    // PO Number is the ONLY match key.
    const tallyPOMap = await fetchTallyPOMap(cfg);
    LOG(`exportPurchaseInvoices: ${pos.length} POs to export, ${tallyPOMap.size} PO numbers already in Tally`);

    // ── Fetch Tally company period end to cap voucher dates ───────────────────
    let periodEnd = await fetchTallyPeriodEnd(cfg);
    if (periodEnd) {
      // Cache for reuse across export tasks (sales may run before purchase and fail to fetch)
      await TallyConfig.findOneAndUpdate({}, { tallyPeriodEnd: periodEnd }, { sort: { _id: 1 } });
    } else {
      const saved = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
      periodEnd = saved?.tallyPeriodEnd || null;
      if (periodEnd) LOG(`exportPurchaseInvoices: using cached periodEnd: ${periodEnd}`);
    }

    const vouchersXml = pos.map(po => {
      // Resolve vendor name: prefer populated reference, fall back to parsing remarks
      // (remarks often contains "Created from RFQ XXX — VendorName's quotation")
      let vendorName = po.vendor?.companyName;

      if (!vendorName) {
        // Try to extract vendor name from remarks: "... — VendorName's quotation"
        const remarkMatch = (po.remarks || '').match(/—\s*(.+?)(?:'s\s+quotation)?$/i);
        if (remarkMatch) {
          vendorName = remarkMatch[1].trim();
          LOG(`PO ${po.poId}: vendor reference missing — using name from remarks: "${vendorName}"`);
        }
      }

      if (!vendorName) {
        // Already synced with no vendor — nothing we can do, skip cleanly
        if (po.tallySync) {
          LOG(`PO ${po.poId}: skipping — already synced (tallySync=true) and vendor reference is missing`);
          return null;
        }
        ERR(`PO ${po.poId}: skipping — vendor reference is missing. Link a vendor to this PO in the ERP before exporting.`);
        return null;
      }

      // ── Match by PO Number ONLY (compute action FIRST, needed for date logic) ─
      const poNumber = (po.poId || '').toUpperCase().trim();
      const existing = poNumber ? tallyPOMap.get(poNumber) : null;
      const action   = existing ? 'Alter' : 'Create';
      const guidTag  = existing ? `<GUID>${esc(existing.guid)}</GUID>` : '';
      LOG(`PO ${po.poId}: ${action}${existing ? ` GUID=${existing.guid}` : ''}`);

      // Compute fresh today inside function — never rely on module-level constant.
      // Always use today for Create — original PO date may be outside Tally's open period,
      // which causes "Voucher date is missing" even though <DATE> is correctly set.
      const freshToday = (() => {
        const n = new Date();
        return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
      })();
      // For Alter, try to preserve the original date; for Create, always use today.
      let voucherDate = freshToday;
      if (action === 'Alter') {
        if (po.deliveryDate) voucherDate = td(po.deliveryDate) || freshToday;
        else if (po.orderDate)  voucherDate = td(po.orderDate)  || freshToday;
        else if (po.poDate)     voucherDate = td(po.poDate)     || freshToday;
        else if (po.createdAt)  voucherDate = td(po.createdAt)  || freshToday;
      }
      voucherDate = capTallyDate(voucherDate, periodEnd);
      LOG(`PO ${po.poId}: voucherDate=${voucherDate}`);

      const items      = po.items || [];
      const subtotal   = +items.reduce((s, i) => s + (+(i.qty || 1)) * (+(i.basePrice || 0)), 0).toFixed(2);

      // Prefer explicit PO-level tax fields; fall back to per-item tax if available.
      // Never estimate with * 0.18 — an approximation always causes Tally imbalance.
      const cgstRaw = +(po.cgstAmount || po.cgst || items.reduce((s, i) => s + (i.cgst || 0), 0) || 0).toFixed(2);
      const sgstRaw = +(po.sgstAmount || po.sgst || items.reduce((s, i) => s + (i.sgst || 0), 0) || 0).toFixed(2);
      const igstRaw = +(po.igstAmount || po.igst || items.reduce((s, i) => s + (i.igst || 0), 0) || 0).toFixed(2);
      // If no explicit GST info use gstTotal, split 50/50 CGST/SGST
      const gstTotal = +(po.gstTotal || 0).toFixed(2);
      const cgst = cgstRaw || +(gstTotal / 2).toFixed(2);
      const sgst = sgstRaw || +(gstTotal - cgst).toFixed(2);
      const igst = igstRaw;

      // grandTotal is the vendor credit (what we owe) — must be the source of truth.
      const grandTotal = +(po.grandTotal || subtotal + cgst + sgst + igst).toFixed(2);

      // purchaseBase = grandTotal goes entirely to Purchase Accounts.
      // Skip separate CGST/SGST/IGST ledger entries — client's Tally uses custom
      // GST ledger names we cannot predict, so sending "CGST"/"SGST" causes EXCEPTIONS.
      const purchaseBase = grandTotal;

      // Distribute purchaseBase across inventory lines; last line absorbs rounding.
      let purAllocated = 0;
      const inventoryLines = items.map((item, i) => {
        const qty   = +(item.qty || item.quantity || 1);
        const rate  = +(item.basePrice || item.unitPrice || 0);
        const total = +(qty * rate).toFixed(2);
        const unit  = tallyUnit(item.unit);
        const isLast = i === items.length - 1;
        const lineAlloc = isLast
          ? +(purchaseBase - purAllocated).toFixed(2)
          : +(subtotal > 0 ? (total / subtotal) * purchaseBase : purchaseBase / items.length).toFixed(2);
        purAllocated = +(purAllocated + lineAlloc).toFixed(2);

        return `
<ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>${esc(item.name || 'Item')}</STOCKITEMNAME>
  <GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
  <ISGSTASSESSABLEVALUEOVERRIDDEN>No</ISGSTASSESSABLEVALUEOVERRIDDEN>
  <RATE>${rate.toFixed(2)} /1 ${unit}</RATE>
  <AMOUNT>${lineAlloc.toFixed(2)}</AMOUNT>
  <ACTUALQTY> ${qty} ${unit}</ACTUALQTY>
  <BILLEDQTY> ${qty} ${unit}</BILLEDQTY>
  <BATCHALLOCATIONS.LIST>
    <AMOUNT>${lineAlloc.toFixed(2)}</AMOUNT>
    <ACTUALQTY> ${qty} ${unit}</ACTUALQTY>
    <BILLEDQTY> ${qty} ${unit}</BILLEDQTY>
    <ADDITIONALDETAILS.LIST></ADDITIONALDETAILS.LIST>
    <VOUCHERCOMPONENTLIST.LIST></VOUCHERCOMPONENTLIST.LIST>
  </BATCHALLOCATIONS.LIST>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>Purchase Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISGSTASSESSABLEVALUEOVERRIDDEN>No</ISGSTASSESSABLEVALUEOVERRIDDEN>
    <AMOUNT>${lineAlloc.toFixed(2)}</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`;
      }).join('');

      // PO date for Tally BASICORDERDATE field (YYYYMMDD format)
      const poOrderDate = td(po.orderDate || po.poDate || po.createdAt);
      const poOrderDateXml = poOrderDate ? `<BASICORDERDATE>${esc(poOrderDate)}</BASICORDERDATE>` : '';

      return `
<VOUCHER VCHTYPE="Purchase" ACTION="${action}">
  <DATE>${voucherDate}</DATE>
  <EFFECTIVEDATE>${voucherDate}</EFFECTIVEDATE>
  ${guidTag}
  <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(po.poId)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(vendorName)}</PARTYLEDGERNAME>
  <BUYERSORDERNO>${esc(po.poId)}</BUYERSORDERNO>
  ${poOrderDateXml}
  <NARRATION></NARRATION>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(vendorName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(po.poId)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Purchase Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>${grandTotal.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>`;
    }).filter(Boolean).join('');

    if (!vouchersXml) {
      LOG('exportPurchaseInvoices: all POs were skipped (missing vendor references or already synced) — nothing to export');
      return { ok: true, records: pos.length, created: 0, altered: 0, error: undefined };
    }

    const resp   = await postXml(cfg, importEnvelope(cfg, 'Vouchers', vouchersXml), 50000);
    const result = parseResponse(resp, 'Purchase Invoices');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Purchase', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: pos.length, triggeredBy });

    if (result.ok) {
      await PurchaseOrder.updateMany({ _id: { $in: pos.map(p => p._id) } }, { tallySync: true, tallySyncAt: new Date() });
    }
    return { ok: result.ok, records: pos.length, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportPurchaseInvoices:', err.message);
    await writeLog({ syncId, type: 'Purchase', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: CREDIT NOTES ────────────────────────────────────────────────

export async function exportCreditNotes(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-CN-${Date.now()}`;
  LOG('exportCreditNotes START');
  try {
    const notes = await CreditNote.find({ status: { $ne: 'Disputed' } }).lean();
    if (!notes.length) return { ok: true, records: 0 };

    const xml = notes.map(cn => `
<VOUCHER VCHTYPE="Credit Note" ACTION="Create">
  <DATE>${td(cn.createdAt) || TODAY}</DATE>
  <VOUCHERTYPENAME>Credit Note</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(cn.cnId)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(cn.party)}</PARTYLEDGERNAME>
  <NARRATION>${esc(cn.reason || cn.cnId)}</NARRATION>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(cn.party)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>-${+(cn.amount || 0).toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>${+(cn.amount || 0).toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>`).join('');

    const resp   = await postXml(cfg, importEnvelope(cfg, 'Vouchers', xml), 30000);
    const result = parseResponse(resp, 'Credit Notes');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Sales', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: notes.length, triggeredBy });
    return { ok: result.ok, records: notes.length, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportCreditNotes:', err.message);
    await writeLog({ syncId, type: 'Sales', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: DEBIT NOTES ─────────────────────────────────────────────────

export async function exportDebitNotes(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-DN-${Date.now()}`;
  LOG('exportDebitNotes START');
  try {
    const notes = await DebitNote.find({ approvalStatus: { $in: ['Approved', 'Posted'] } }).lean();
    if (!notes.length) return { ok: true, records: 0 };

    const xml = notes.map(dn => `
<VOUCHER VCHTYPE="Debit Note" ACTION="Create">
  <DATE>${td(dn.createdAt) || TODAY}</DATE>
  <VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(dn.dnId)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(dn.vendorName)}</PARTYLEDGERNAME>
  <NARRATION>${esc(dn.reason || dn.dnId)}</NARRATION>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(dn.vendorName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>${+(dn.totalAmount || dn.debitAmount || 0).toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Purchase Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>-${+(dn.totalAmount || dn.debitAmount || 0).toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>`).join('');

    const resp   = await postXml(cfg, importEnvelope(cfg, 'Vouchers', xml), 30000);
    const result = parseResponse(resp, 'Debit Notes');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Purchase', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: notes.length, triggeredBy });
    return { ok: result.ok, records: notes.length, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportDebitNotes:', err.message);
    await writeLog({ syncId, type: 'Purchase', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: PAYMENT VOUCHERS ───────────────────────────────────────────

export async function exportPaymentVouchers(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-PAY-${Date.now()}`;
  LOG('exportPaymentVouchers START');
  try {
    const payments = await TallyVoucher.find({ voucherType: 'Payment', source: 'ERP', tallyGuid: { $exists: false } }).lean();
    if (!payments.length) return { ok: true, records: 0 };

    const xml = payments.map(pmt => {
      const ledgersXml = (pmt.ledgerEntries || []).map(e => `
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>
  <ISDEEMEDPOSITIVE>${e.isDeemed ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
  <AMOUNT>${e.isDeemed ? '' : '-'}${Math.abs(e.amount || 0).toFixed(2)}</AMOUNT>
</ALLLEDGERENTRIES.LIST>`).join('');
      return `
<VOUCHER VCHTYPE="Payment" ACTION="Create">
  <DATE>${td(pmt.voucherDate) || TODAY}</DATE>
  <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(pmt.voucherNumber || '')}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(pmt.partyName || '')}</PARTYLEDGERNAME>
  <NARRATION>${esc(pmt.narration || 'Payment')}</NARRATION>
  ${ledgersXml}
</VOUCHER>`;
    }).join('');

    const resp   = await postXml(cfg, importEnvelope(cfg, 'Vouchers', xml), 30000);
    const result = parseResponse(resp, 'Payment Vouchers');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Payment', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: payments.length, triggeredBy });
    return { ok: result.ok, records: payments.length, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportPaymentVouchers:', err.message);
    await writeLog({ syncId, type: 'Payment', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: RECEIPT VOUCHERS ───────────────────────────────────────────

export async function exportReceiptVouchers(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-REC-${Date.now()}`;
  LOG('exportReceiptVouchers START');
  try {
    const receipts = await TallyVoucher.find({ voucherType: 'Receipt', source: 'ERP', tallyGuid: { $exists: false } }).lean();
    if (!receipts.length) return { ok: true, records: 0 };

    const xml = receipts.map(rec => {
      const ledgersXml = (rec.ledgerEntries || []).map(e => `
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>
  <ISDEEMEDPOSITIVE>${e.isDeemed ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
  <AMOUNT>${e.isDeemed ? '' : '-'}${Math.abs(e.amount || 0).toFixed(2)}</AMOUNT>
</ALLLEDGERENTRIES.LIST>`).join('');
      return `
<VOUCHER VCHTYPE="Receipt" ACTION="Create">
  <DATE>${td(rec.voucherDate) || TODAY}</DATE>
  <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(rec.voucherNumber || '')}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(rec.partyName || '')}</PARTYLEDGERNAME>
  <NARRATION>${esc(rec.narration || 'Receipt')}</NARRATION>
  ${ledgersXml}
</VOUCHER>`;
    }).join('');

    const resp   = await postXml(cfg, importEnvelope(cfg, 'Vouchers', xml), 30000);
    const result = parseResponse(resp, 'Receipt Vouchers');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Receipt', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: receipts.length, triggeredBy });
    return { ok: result.ok, records: receipts.length, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportReceiptVouchers:', err.message);
    await writeLog({ syncId, type: 'Receipt', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── EXPORT TASK: JOURNAL VOUCHERS ───────────────────────────────────────────

export async function exportJournalVouchers(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-JNL-${Date.now()}`;
  LOG('exportJournalVouchers START');
  try {
    const journals = await TallyVoucher.find({ voucherType: 'Journal', source: 'ERP', tallyGuid: { $exists: false } }).lean();
    if (!journals.length) return { ok: true, records: 0 };

    const xml = journals.map(j => {
      const ledgersXml = (j.ledgerEntries || []).map(e => `
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>
  <ISDEEMEDPOSITIVE>${e.isDeemed ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
  <AMOUNT>${e.isDeemed ? '' : '-'}${Math.abs(e.amount || 0).toFixed(2)}</AMOUNT>
</ALLLEDGERENTRIES.LIST>`).join('');
      return `
<VOUCHER VCHTYPE="Journal" ACTION="Create">
  <DATE>${td(j.voucherDate) || TODAY}</DATE>
  <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(j.voucherNumber || '')}</VOUCHERNUMBER>
  <NARRATION>${esc(j.narration || 'Journal Entry')}</NARRATION>
  ${ledgersXml}
</VOUCHER>`;
    }).join('');

    const resp   = await postXml(cfg, importEnvelope(cfg, 'Vouchers', xml), 30000);
    const result = parseResponse(resp, 'Journal Vouchers');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Journal', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: journals.length, triggeredBy });
    return { ok: result.ok, records: journals.length, created: result.created, altered: result.altered, error: result.error, warning: result.warning };
  } catch (err) {
    ERR('exportJournalVouchers:', err.message);
    await writeLog({ syncId, type: 'Journal', direction: 'ERP → Tally', status: 'Failed', error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── FULL EXPORT ORCHESTRATOR ─────────────────────────────────────────────────

/**
 * runFullExportToTally
 * Exports ERP vouchers to Tally: Sales Invoices + Purchase Invoices only.
 * Master data (Ledgers, Stock Items, Units, Groups, etc.) is NOT exported.
 */
export async function runFullExportToTally(cfg, triggeredBy, onProgress = () => {}) {
  const startTime = Date.now();

  const TASKS = [
    { key: 'salesInvoices',    label: 'Sales Invoices',    fn: () => exportSalesInvoices(cfg, triggeredBy) },
    { key: 'purchaseInvoices', label: 'Purchase Invoices', fn: () => exportPurchaseInvoices(cfg, triggeredBy) },
  ];

  const results = [];
  let totalRecords = 0;
  let totalSuccess = 0;
  let totalFailed  = 0;

  for (let i = 0; i < TASKS.length; i++) {
    const task = TASKS[i];
    onProgress({ event: 'phase_start', index: i + 1, total: TASKS.length, entity: task.label, message: `Exporting ${task.label}…` });

    let result;
    try {
      result = await task.fn();
    } catch (e) {
      result = { ok: false, records: 0, error: e.message };
    }

    const rec = result.records || 0;
    totalRecords += rec;

    if (result.ok) {
      totalSuccess += rec;
      onProgress({
        event: 'phase_done', ok: true, entity: task.label,
        records: rec, created: result.created || 0, altered: result.altered || 0,
        warning: result.warning,
        message: `✅ ${task.label}: ${rec} records${result.warning ? ` (⚠️ ${result.warning.slice(0, 80)})` : ''}`,
      });
    } else {
      totalFailed++;
      onProgress({
        event: 'phase_done', ok: false, entity: task.label,
        records: rec, error: result.error,
        message: `❌ ${task.label}: ${result.error || 'Failed'}`,
      });
    }

    results.push({ key: task.key, label: task.label, ...result });
    // Short pause between tasks to avoid overloading Tally
    await new Promise(r => setTimeout(r, 250));
  }

  const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
  const overallOk = totalFailed === 0;

  await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date(), lastExportAt: new Date() }, { upsert: true });

  const summary = {
    ok: overallOk,
    totalRecords, totalSuccess, totalFailed,
    duration, results,
  };

  onProgress({ event: 'summary', direction: 'ERP → Tally', stats: { total: totalRecords, created: totalSuccess, updated: 0, failed: totalFailed }, duration, results, message: `Export complete — ${totalRecords} records exported to Tally in ${duration}` });

  return summary;
}

// ─── SELECTIVE EXPORT ────────────────────────────────────────────────────────

/**
 * Run a specific export task by key.
 * key: 'units' | 'stockGroups' | 'godowns' | 'systemLedgers' | 'vendorLedgers' |
 *      'customerLedgers' | 'stockItems' | 'salesInvoices' | 'purchaseInvoices' |
 *      'creditNotes' | 'debitNotes' | 'paymentVouchers' | 'receiptVouchers' | 'journalVouchers'
 */
export async function runSelectiveExport(cfg, key, triggeredBy) {
  const map = {
    units:            exportUnits,
    stockGroups:      exportStockGroups,
    godowns:          exportGodowns,
    systemLedgers:    exportSystemLedgers,
    vendorLedgers:    exportVendorLedgers,
    customerLedgers:  exportCustomerLedgers,
    stockItems:       exportStockItems,
    salesInvoices:    exportSalesInvoices,
    purchaseInvoices: exportPurchaseInvoices,
    creditNotes:      exportCreditNotes,
    debitNotes:       exportDebitNotes,
    paymentVouchers:  exportPaymentVouchers,
    receiptVouchers:  exportReceiptVouchers,
    journalVouchers:  exportJournalVouchers,
  };
  const fn = map[key];
  if (!fn) return { ok: false, error: `Unknown export task key: ${key}` };
  return fn(cfg, triggeredBy);
}

// ─── FUTURE-READY STUBS ───────────────────────────────────────────────────────
// These are reserved for the future Import from Tally feature.
// Keep them in this file so the integration grows symmetrically.

/** @future — Import all data from Tally into ERP */
export async function importFromTally(cfg, triggeredBy, onProgress = () => {}) {
  throw new Error('importFromTally is not yet implemented. Use the Tally → ERP import endpoint.');
}
