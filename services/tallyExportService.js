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

const TODAY = td(new Date());

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
  // Fall back to the known company name so exports work even if companyName was
  // never saved to TallyConfig.
  const co = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim().toUpperCase();
  // SVSHOWERRORLIST=Yes forces Tally to include LINEERROR tags in EVERY response
  // so we can see the exact rejection reason instead of just EXCEPTIONS count.
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
  LOG(`postXml → ${xml.length} bytes, timeout ${timeoutMs}ms`);
  return postXmlWithRetry(cfg, xml, timeoutMs);
}

// ─── RESPONSE PARSER ─────────────────────────────────────────────────────────

function parseResponse(xml, label = '') {
  if (!xml || !xml.trim()) return { ok: false, error: 'Empty response from Tally' };
  const s = String(xml);

  // Log the full raw response for debugging — critical for diagnosing Tally issues
  LOG(`${label} RAW RESPONSE (first 3000 chars):\n${s.slice(0, 3000)}`);

  // Collect all line errors — log each one in full so we can see exactly what Tally says
  const errors = [];
  for (const m of s.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)) {
    const msg = m[1].trim();
    if (msg) {
      errors.push(msg);
      ERR(`${label} LINEERROR: ${msg}`);
    }
  }
  // <ERRORS> in Tally's IMPORTRESULT is a COUNT (integer), not a message string.
  // Only treat it as a problem when the count is > 0.
  const errTag = s.match(/<ERRORS>(\d+)<\/ERRORS>/i);
  const errCount = errTag ? parseInt(errTag[1], 10) : 0;
  if (errCount > 0) {
    const msg = `Tally reported ${errCount} import error(s)`;
    errors.push(msg);
    ERR(`${label} ERRORS count: ${errCount}`);
  }

  // <EXCEPTIONS> = Tally business-logic rejections (party ledger not found,
  // imbalanced voucher, duplicate voucher number, etc.).
  // Tally silently discards excepted vouchers — they never appear in Tally.
  // Do NOT tell user to "run master sync" — the actual cause is usually a name
  // mismatch between ERP partyName and the ledger name in Tally.
  const excTag = s.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i);
  const excCount = excTag ? parseInt(excTag[1], 10) : 0;
  if (excCount > 0) {
    const msg = `Tally rejected ${excCount} record(s) — possible causes: party ledger name mismatch, imbalanced voucher amounts, or duplicate voucher number. Check server logs for details.`;
    errors.push(msg);
    ERR(`${label} EXCEPTIONS count: ${excCount}`);
  }

  const created = parseInt(s.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1] || '0');
  const altered = parseInt(s.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1] || '0');
  const skipped = parseInt(s.match(/<SKIPPED>(\d+)<\/SKIPPED>/i)?.[1] || '0');

  LOG(`${label} → created:${created} altered:${altered} skipped:${skipped} errors:${errors.length}`);

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
    const body = await postXmlWithRetry(cfg, PING_XML, 20000);
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

    const resp = await postXmlWithRetry(cfg, xml, 60000);
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

export async function exportSalesInvoices(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `EXPORT-SALES-${Date.now()}`;
  LOG('exportSalesInvoices START');
  try {
    // Export all ERP-created invoices. Skip only Cancelled and Tally-origin invoices.
    // PO number matching (below) handles create vs update — no tallySync filter needed.
    const invoices = await Invoice.find({
      status: { $nin: ['Cancelled'] },
      source: { $nin: ['Tally', 'tally'] },
    }).lean();

    if (!invoices.length) return { ok: true, records: 0 };

    LOG(`exportSalesInvoices: ${invoices.length} invoices to export`);
    LOG(`First invoice: no=${invoices[0].invoiceNo} source=${invoices[0].source} PO=${invoices[0].buyersOrderNo || 'none'}`);

    // ── Step 1: Auto-create required ledgers & stock items BEFORE vouchers ───
    // Collect unique party names and stock item names from all invoices.
    // ACTION="Create" — Tally silently skips records that already exist.
    const partyNames = [...new Set(invoices.map(inv => inv.partyName).filter(Boolean))];
    const stockNames = [...new Set(
      invoices.flatMap(inv => (inv.items || []).map(i => (i.description || i.name || '').trim())).filter(Boolean)
    )];

    const autoLedgerXml = [
      `<LEDGER NAME="Sales Accounts" ACTION="Create"><NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT></LEDGER>`,
      `<LEDGER NAME="CGST" ACTION="Create"><NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="SGST" ACTION="Create"><NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="IGST" ACTION="Create"><NAME>IGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      ...partyNames.map(name =>
        `<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>`
      ),
    ].join('');

    const autoStockXml = stockNames.map(name =>
      `<STOCKITEM NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><UNITS>Nos</UNITS></STOCKITEM>`
    ).join('');

    LOG(`Sales: auto-creating ${partyNames.length} party ledgers + ${stockNames.length} stock items before vouchers`);
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

    const failedItems = [];
    const vouchersXml = invoices.map((inv, idx) => {
      try {
        const date = td(inv.invoiceDate) || TODAY;

        // ── Match by PO Number ONLY ─────────────────────────────────────────
        const poNumber = (inv.buyersOrderNo || '').toUpperCase().trim();
        const existing = poNumber ? tallyPOMap.get(poNumber) : null;
        const action   = existing ? 'Alter' : 'Create';
        const guidTag  = existing ? `<GUID>${esc(existing.guid)}</GUID>` : '';
        LOG(`Invoice ${inv.invoiceNo} (PO: ${poNumber || 'none'}): ${action}${existing ? ` GUID=${existing.guid}` : ''}`);

        // ── Amount balance guarantee ───────────────────────────────────────
        // Strategy: skip separate CGST/SGST/IGST ledger entries entirely.
        // The client's Tally uses custom GST ledger names (e.g. "Output CGST @ 9%")
        // that we cannot know in advance. Sending "CGST"/"SGST" causes EXCEPTIONS
        // because those ledgers don't exist in this Tally company.
        //
        // Instead: party debit = grandTotal, Sales Accounts credit = grandTotal.
        // This always balances (zero sum) and Tally accepts it without needing
        // specific GST ledger names. Tax reporting is handled separately in Tally.
        const grandTotal = +(inv.grandTotal || inv.totalAmount || 0).toFixed(2);

        // Per-item line amounts (base amounts)
        const itemLines = (inv.items || []).map(item => ({
          name: item.description || item.name || 'Item',
          unit: tallyUnit(item.unit),
          rate: +(item.rate || item.unitPrice || 0),
          qty:  +(item.qty || item.quantity || 1),
          amt:  +(item.amount || item.total || (item.qty || 1) * (item.rate || item.unitPrice || 0) || 0),
        }));

        // salesBase = grandTotal distributed across inventory lines
        // (no separate GST ledger entries — avoids ledger-name mismatch EXCEPTIONS)
        const itemsSubtotal = +itemLines.reduce((s, i) => s + i.amt, 0).toFixed(2);
        const salesBase     = grandTotal; // full grandTotal goes to Sales Accounts

        // Distribute salesBase across inventory lines proportionally.
        // Last line absorbs any rounding remainder.
        let allocated = 0;
        const inventoryLines = itemLines.map((item, i) => {
          const isLast = i === itemLines.length - 1;
          const lineAlloc = isLast
            ? +(salesBase - allocated).toFixed(2)
            : +(itemsSubtotal > 0 ? (item.amt / itemsSubtotal) * salesBase : salesBase / itemLines.length).toFixed(2);
          allocated = +(allocated + lineAlloc).toFixed(2);

          // Match Tally's own Sales voucher structure exactly:
          // Item ISDEEMEDPOSITIVE=No, AMOUNT=positive
          // Sales Accounts ISDEEMEDPOSITIVE=No, AMOUNT=positive
          return `
<ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>${esc(item.name)}</STOCKITEMNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
  <RATE>${item.rate.toFixed(2)} /1 ${item.unit}</RATE>
  <AMOUNT>${lineAlloc.toFixed(2)}</AMOUNT>
  <ACTUALQTY>${item.qty} ${item.unit}</ACTUALQTY>
  <BILLEDQTY>${item.qty} ${item.unit}</BILLEDQTY>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${lineAlloc.toFixed(2)}</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`;
        }).join('');

        const voucherXml = `
<VOUCHER VCHTYPE="Sales" ACTION="${action}">
  ${guidTag}
  <DATE>${date}</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
  <VOUCHERNUMBER>${esc(inv.invoiceNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(inv.partyName)}</PARTYLEDGERNAME>
  <BUYERSORDERNO>${esc(inv.buyersOrderNo || '')}</BUYERSORDERNO>
  <NARRATION>ERP Invoice: ${esc(inv.invoiceNo)} | ${esc(inv.partyName)}</NARRATION>
  <ISINVOICE>Yes</ISINVOICE>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
  <ISNEGISPOSSET>Yes</ISNEGISPOSSET>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(inv.partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${inventoryLines}
</VOUCHER>`;

        if (idx === 0) LOG(`exportSalesInvoices: FIRST INVOICE XML SENT TO TALLY:\n${voucherXml}`);
        return voucherXml;
      } catch (e) {
        failedItems.push({ id: inv.invoiceNo, error: e.message });
        return '';
      }
    }).filter(Boolean).join('');

    const resp   = await postXml(cfg, importEnvelope(cfg, 'Vouchers', vouchersXml), 50000);
    const result = parseResponse(resp, 'Sales Invoices');
    const dur    = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Sales', direction: 'ERP → Tally', status: result.ok ? 'Success' : 'Failed', duration: dur, error: result.error, records: invoices.length, triggeredBy });

    if (result.ok) {
      await Invoice.updateMany({ _id: { $in: invoices.map(i => i._id) } }, { tallySync: true, tallySyncAt: new Date() });
    }
    return { ok: result.ok, records: invoices.length, created: result.created, altered: result.altered, error: result.error, warning: result.warning, failedItems };
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
    const vendorNames = [...new Set(pos.map(po => po.vendor?.companyName).filter(Boolean))];
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

    const vouchersXml = pos.map(po => {
      const vendorName = po.vendor?.companyName || 'Unknown Vendor';
      let voucherDate = null;
      if (po.deliveryDate) voucherDate = td(po.deliveryDate);
      if (!voucherDate && po.createdAt) voucherDate = td(po.createdAt);
      if (!voucherDate) voucherDate = TODAY;

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

      // ── Match by PO Number ONLY ─────────────────────────────────────────
      // po.poId IS the PO Number. Look it up in Tally's BuyersOrderNo index.
      const poNumber = (po.poId || '').toUpperCase().trim();
      const existing = poNumber ? tallyPOMap.get(poNumber) : null;
      const action   = existing ? 'Alter' : 'Create';
      const guidTag  = existing ? `<GUID>${esc(existing.guid)}</GUID>` : '';
      LOG(`PO ${po.poId}: ${action}${existing ? ` GUID=${existing.guid}` : ''}`);

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
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
  <RATE>${rate.toFixed(2)} /1 ${unit}</RATE>
  <AMOUNT>${lineAlloc.toFixed(2)}</AMOUNT>
  <ACTUALQTY>${qty} ${unit}</ACTUALQTY>
  <BILLEDQTY>${qty} ${unit}</BILLEDQTY>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>Purchase Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${lineAlloc.toFixed(2)}</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`;
      }).join('');

      return `
<VOUCHER VCHTYPE="Purchase" ACTION="${action}">
  ${guidTag}
  <DATE>${voucherDate}</DATE>
  <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
  <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
  <VOUCHERNUMBER>${esc(po.poId)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(vendorName)}</PARTYLEDGERNAME>
  <BUYERSORDERNO>${esc(po.poId)}</BUYERSORDERNO>
  <NARRATION>PO: ${esc(po.poId)} | ${esc(vendorName)}</NARRATION>
  <ISINVOICE>Yes</ISINVOICE>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
  <ISNEGISPOSSET>Yes</ISNEGISPOSSET>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(vendorName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${inventoryLines}
</VOUCHER>`;
    }).join('');

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
