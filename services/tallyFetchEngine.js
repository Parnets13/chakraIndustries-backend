
import axios from 'axios';
import http from 'http';
import { XMLParser } from 'fast-xml-parser';
import TallyConfig from '../models/TallyConfig.js';
import TallySyncState from '../models/TallySyncState.js';
import TallySyncLog from '../models/TallySyncLog.js';
import ItemMaster from '../models/ItemMaster.js';
import AccountsLedger from '../models/AccountsLedger.js';
import Vendor from '../models/Vendor.js';
import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
import TallyVoucher from '../models/TallyVoucher.js';
import { sendTallyRequest, isConnectorOnline } from './tallyConnectorServer.js';

// === CONSTANTS ===
const CHUNK_DAYS = 30;  // Fetch 30 days per chunk (Tally honours short date ranges reliably)
const MAX_CHUNK_RETRIES = 3;
const MIN_RESPONSE_BYTES = 200;

// === HISTORICAL DATA START DATE ===
// All voucher and date-based entity syncs begin from this date.
// Set to April 1, 2024 (start of FY 2024-25) to capture complete historical data.
// Change this constant (not scattered year logic) if the baseline ever needs to shift.
const HISTORY_START_DATE = new Date(2024, 3, 1); // 2024-04-01 (month index 3 = April)

// === ENTITY-SPECIFIC DYNAMIC TIMEOUTS (ms) ===
// Increased for connector mode — requests go internet → connector → Tally → back
// Tally can be slow on large datasets; give it enough time.
const ENTITY_TIMEOUTS = {
  Ledgers:     300000,  // 5 min  — ledger list can be large
  Items:       300000,  // 5 min  — stock items collection
  Purchase:    600000,  // 10 min — all purchase vouchers
  Sales:       600000,  // 10 min — all sales vouchers
  Payment:     600000,  // 10 min
  Receipt:     600000,  // 10 min
  Journal:     600000,  // 10 min
  Contra:      600000,  // 10 min
};
const HEALTH_CHECK_TIMEOUT = 90000;  // 90s — connector roundtrip + Tally processing time

// === GLOBAL STATE ===
let _tallyRequestLock = false;
let _requestQueue = [];
let _syncInProgress = false;
let _healthCheckInProgress = false;

// === XML PARSER ===
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  allowBooleanAttributes: true,
  ignoreDeclaration: true,
  trimValues: false,
  processEntities: true,
  arrayMode: (tagName, jPath, isLeafNode, isAttribute) => {
    // Always treat these as arrays regardless of count in the XML
    return ['LEDGER', 'STOCKITEM', 'VOUCHER',
      'TALLYMESSAGE',
      'ALLLEDGERENTRIES.LIST', 'LEDGERENTRIES.LIST',
      'ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST',
      'BILLALLOCATIONS.LIST', 'BATCHALLOCATIONS.LIST',
      'ACCOUNTINGALLOCATIONS.LIST', 'GSTADVADJDETAILS.LIST',
      'ADDRESS', 'BASICBUYERADDRESS', 'DISPATCHFROMADDRESS',
    ].includes(tagName);
  }
});

// === LOGGING HELPERS ===
const LOG = (msg) => console.log(`[Tally] ${msg}`);
const ERR = (msg, err) => console.error(`[Tally ERROR] ${msg}`, err ? err.message || err : '');

// === HTTP AGENT FOR KEEP-ALIVE ===
const httpAgent = new http.Agent({ keepAlive: true });

// === AXIOS INSTANCE ===
const axiosInstance = axios.create({
  headers: {
    'Content-Type': 'text/xml',
    'Accept': '*/*',
  },
  httpAgent,
  maxRedirects: 5,
  validateStatus: () => true,
});

// === LOCK/QUEUE ===
async function acquireLock() {
  LOG('Lock Acquired');
  while (_tallyRequestLock) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  _tallyRequestLock = true;
}

function releaseLock() {
  LOG('Lock Released');
  _tallyRequestLock = false;
  if (_requestQueue.length > 0) {
    const next = _requestQueue.shift();
    next();
  }
}

// === CONFIG HELPERS ===
async function getCfg() {
  let cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
  if (!cfg) cfg = await TallyConfig.create({});
  return cfg;
}

function tallyBaseUrl(cfg) {
  const port = cfg.port || '9000';
  const local = (cfg.tallyLocalUrl || '').trim();
  if (local) {
    if (local.startsWith('https://')) return local.replace(/\/$/, '');
    if (local.match(/:\d+$/)) return local.replace(/\/$/, '');
    return `${local.replace(/\/$/, '')}:${port}`;
  }
  const server = (cfg.serverUrl || '').trim();
  // Never use the cloud ERP URL as a Tally endpoint
  if (server && !server.includes('erp.majesticmall.net')) {
    if (server.startsWith('https://')) return server.replace(/\/$/, '');
    if (server.match(/:\d+$/)) return server.replace(/\/$/, '');
    return `${server.replace(/\/$/, '')}:${port}`;
  }
  // ── SAFETY: never silently fall back to localhost on a remote server ────────
  // If we are here it means no URL is configured. Throw instead of returning
  // localhost — on Render this would silently fail with ECONNREFUSED.
  throw new Error(
    'Tally URL not configured. Set tallyLocalUrl in Tally Settings, or enable Connector mode.'
  );
}

function buildHeaders(cfg) {
  const h = { 'Content-Type': 'text/xml', Accept: '*/*' };
  if (cfg.authType === 'Basic Auth' && cfg.apiKey)
    h['Authorization'] = `Basic ${Buffer.from(cfg.apiKey).toString('base64')}`;
  else if (cfg.authType === 'API Key' && cfg.apiKey)
    h['Authorization'] = `Bearer ${cfg.apiKey}`;
  return h;
}

// === XML HELPERS ===
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
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

function decodeXmlEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[\r\n]+/g, ' ');
}

// === XML VALIDATION ===
function validateXml(xml) {
  if (!xml || typeof xml !== 'string') return false;
  const trimmed = xml.trim();
  if (!trimmed.startsWith('<ENVELOPE>')) return false;
  if (!trimmed.endsWith('</ENVELOPE>')) return false;
  return true;
}

// === RESPONSE VALIDATION ===
function isResponseComplete(xml) {
  if (!xml || xml.length < MIN_RESPONSE_BYTES) return false;
  const trimmed = xml.trimEnd();
  if (trimmed.endsWith('</ENVELOPE>') || trimmed.endsWith('</TALLYMESSAGE>')) return true;
  if (trimmed.endsWith('</LINEERROR>') || trimmed.endsWith('</ERRORS>')) return true;
  const lastAngle = trimmed.lastIndexOf('<');
  if (lastAngle > trimmed.length - 50) {
    const tail = trimmed.slice(lastAngle);
    if (!tail.includes('>')) return false;
  }
  return true;
}

// === CHUNK GENERATOR ===
function buildChunks(fromDate, toDate, chunkDays = CHUNK_DAYS) {
  const chunks = [];
  let cursor = new Date(fromDate);
  const end = new Date(toDate);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push({ fromDate: new Date(cursor), toDate: new Date(chunkEnd) });
    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

// === SYNC STATE HELPERS ===
async function getOrCreateState(entityType) {
  let state = await TallySyncState.findOne({ entityType });
  if (!state) {
    state = await TallySyncState.create({ entityType });
  }
  return state;
}

async function writeSyncLog({ syncId, type, direction, status, duration, error, records }) {
  try {
    await TallySyncLog.create({
      syncId, type, entity: '', direction,
      status, duration: duration || '0s',
      error: error || '', records: records || 0,
    });
  } catch (_) {}
}

// === HEALTH CHECK ===
export async function checkTallyReachable(cfg) {
  // ── Connector mode: ping via Socket.IO, not direct HTTP ─────────────────────
  if (cfg.useConnector && cfg.connectorId) {
    let online = isConnectorOnline(cfg.connectorId);
    console.log(`[TallyRoute] checkTallyReachable → connector ${cfg.connectorId} online=${online}`);
    if (!online) {
      console.log(`[TallyRoute] Connector not yet online — waiting up to 15s for reconnect…`);
      const { waitForConnector } = await import('./tallyConnectorServer.js');
      const c = await waitForConnector(cfg.connectorId, 15000);
      online = !!(c && c.online);
      console.log(`[TallyRoute] After wait, connector online=${online}`);
    }
    if (!online) {
      // ── Connector offline fallback: if tallyLocalUrl is set, try direct ──
      if (cfg.tallyLocalUrl) {
        console.log(`[TallyRoute] Connector offline — falling back to direct: ${cfg.tallyLocalUrl}`);
        // fall through to direct mode below
      } else {
        return { reachable: false, error: `Connector ${cfg.connectorId} is offline. Start the SriChakra Connector on the client PC, or set tallyLocalUrl for local testing.` };
      }
    } else {
      // connector is online — ping through it
      const pingXml = `<ENVELOPE><HEADER><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>`;
      try {
        const body = await sendTallyRequest(cfg.connectorId, pingXml, HEALTH_CHECK_TIMEOUT);
        return { reachable: body.length > 0, status: 200, body: body.slice(0, 200) };
      } catch (err) {
        return { reachable: false, error: err.message };
      }
    }
  }

  // ── Direct mode ──────────────────────────────────────────────────────────────
  let url;
  try {
    url = tallyBaseUrl(cfg);
  } catch (e) {
    return { reachable: false, error: e.message };
  }
  const pingXml = `<ENVELOPE>
  <HEADER>
   <TALLYREQUEST>Export</TALLYREQUEST>
   <TYPE>Collection</TYPE>
   <ID>List of Companies</ID>
  </HEADER>
  <BODY>
   <DESC>
    <STATICVARIABLES>
     <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
   </DESC>
  </BODY>
 </ENVELOPE>`;
  
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      LOG(`Health Check Started (attempt ${attempt}/3)`);
      const resp = await axiosInstance.post(url, pingXml, {
        timeout: HEALTH_CHECK_TIMEOUT,
        headers: buildHeaders(cfg),
      });
      const body = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
      if (body.length > 0) {
        return { reachable: true, status: resp.status, body: body.slice(0, 200) };
      }
      lastErr = new Error('Empty response');
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
  
  const code = lastErr?.code || '';
  let errorMsg = lastErr?.message || 'Unknown error';
  if (code === 'ECONNRESET' || lastErr?.message?.includes('socket hang up')) {
    errorMsg = 'Tally closed connection. Ensure HTTP server is enabled.';
  } else if (code === 'ECONNREFUSED') {
    errorMsg = `Connection refused at ${url}. Check Tally HTTP server.`;
  } else if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    errorMsg = `Health check timeout after ${HEALTH_CHECK_TIMEOUT / 1000}s at ${url}.`;
  } else if (code === 'ENOTFOUND') {
    errorMsg = 'Cannot resolve host. Check Tally URL.';
  }
  return { reachable: false, error: errorMsg };
}

export async function testTallyConnection() {
  if (_healthCheckInProgress) {
    LOG('Health Check Skipped (already in progress)');
    return { status: 'Skipped', error: 'Health check already in progress' };
  }
  _healthCheckInProgress = true;
  try {
    LOG('Health Check Started');
    const cfg = await getCfg();
    const check = await checkTallyReachable(cfg);
    if (check.reachable) {
      await TallyConfig.findOneAndUpdate({}, { connectionStatus: 'Connected' }, { sort: { _id: 1 }, upsert: true });
      LOG('Health Check Success');
      return { status: 'Connected', error: null };
    } else {
      await TallyConfig.findOneAndUpdate({}, { connectionStatus: 'Disconnected' }, { sort: { _id: 1 }, upsert: true });
      LOG('Health Check Failed');
      return { status: 'Disconnected', error: check.error };
    }
  } finally {
    _healthCheckInProgress = false;
  }
}

// === HTTP POST WITH RETRIES AND TIMEOUT ===
async function postXml(cfg, xml, timeoutMs) {
  const connectorMode = cfg.useConnector && cfg.connectorId;
  const connectorOnline = connectorMode ? isConnectorOnline(cfg.connectorId) : false;
  const hasLocalUrl = !!(cfg.tallyLocalUrl || '').trim();

  // ── Routing decision ────────────────────────────────────────────────────────
  // 1. Connector mode + connector online  → use connector (production path)
  // 2. Connector mode + connector OFFLINE + tallyLocalUrl set → fallback to direct (local dev)
  // 3. Connector mode + connector OFFLINE + no local URL → error
  // 4. Direct mode → use tallyLocalUrl directly

  const useConnectorPath = connectorMode && connectorOnline;
  const useDirectFallback = connectorMode && !connectorOnline && hasLocalUrl;

  console.log('[TallyRoute]', {
    useConnector: cfg.useConnector,
    connectorId:  cfg.connectorId || '(empty)',
    connectorOnline,
    tallyLocalUrl: cfg.tallyLocalUrl || '(empty)',
    selectedPath: useConnectorPath
      ? 'CONNECTOR → Socket.IO'
      : useDirectFallback
        ? 'DIRECT → HTTP (connector offline fallback)'
        : 'DIRECT → HTTP',
  });

  // ── PATH A: Connector online ─────────────────────────────────────────────────
  if (useConnectorPath) {
    if (!validateXml(xml)) throw new Error('Invalid XML format');
    LOG(`POST via connector ${cfg.connectorId} bytes=${xml.length} timeout=${timeoutMs}ms`);
    console.log('[Tally] Full Request XML:\n', xml);
    const body = await sendTallyRequest(cfg.connectorId, xml, timeoutMs);
    LOG(`  → Received bytes=${body.length}`);
    console.log('[Tally] Full Response XML:\n', body);
    const isImportResponse = body.includes('<RESPONSE>') || body.includes('<CREATED>');
    if (!isImportResponse && body.includes('<LINEERROR>')) {
      throw new Error(`Tally returned LINEERROR: ${body}`);
    }
    if (body.includes('<STATUS>0</STATUS>')) return '';
    return body;
  }

  // ── PATH B: Connector offline but tallyLocalUrl is set → direct fallback ────
  if (useDirectFallback) {
    LOG(`Connector offline — falling back to direct: ${cfg.tallyLocalUrl}`);
  }

  // ── PATH C: Direct mode — guard against cloud servers without a local URL ───
  // If connectorId is registered but connector is offline AND no local URL → error.
  if (connectorMode && !connectorOnline && !hasLocalUrl) {
    throw new Error(
      `Connector "${cfg.connectorId}" is offline and no tallyLocalUrl is set. ` +
      `Either start the SriChakra Connector on the client PC, or set tallyLocalUrl in Tally Settings.`
    );
  }

  const url = tallyBaseUrl(cfg); // throws if URL is not configured
  if (!validateXml(xml)) throw new Error('Invalid XML format');
  LOG(`POST ${url} bytes=${xml.length} timeout=${timeoutMs}ms`);
  console.log('[Tally] Full Request XML:\n', xml);
  const resp = await axiosInstance.post(url, xml, {
    timeout: timeoutMs,
    headers: buildHeaders(cfg),
  });
  const body = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
  LOG(`  → HTTP ${resp.status} bytes=${body.length}`);
  console.log('[Tally] Full Response XML:\n', body);
  const isImportResponse = body.includes('<RESPONSE>') || body.includes('<CREATED>');
  if (!isImportResponse && body.includes('<LINEERROR>')) {
    throw new Error(`Tally returned LINEERROR: ${body}`);
  }
  if (body.includes('<STATUS>0</STATUS>')) return '';
  return body;
}

export async function postXmlWithRetry(cfg, xml, timeoutMs, attempts = MAX_CHUNK_RETRIES) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const body = await postXml(cfg, xml, timeoutMs);
      if (i > 0) LOG(`  ✅ Succeeded on attempt ${i+1}/${attempts} after previous disconnect`);
      return body; // Return any valid response (no length check)
    } catch (err) {
      lastErr = err;
      ERR(`Attempt ${i+1}/${attempts} failed: ${err.message}`);
    }
    if (i < attempts - 1) {
      const isDisconnect = lastErr?.message?.includes('disconnected') || 
                           lastErr?.message?.includes('not online') ||
                           lastErr?.message?.includes('reconnected mid-request');
      const isTallyNotRunning = lastErr?.message?.includes('not running') || lastErr?.message?.includes('TallyPrime');

      if (isDisconnect || isTallyNotRunning) {
        // Connector dropped or Tally pre-check failed on connector side.
        // Wait for the connector to fully reconnect and stabilise before retrying.
        // The connector needs time to: reconnect socket + re-register listeners + verify Tally.
        LOG(`  Waiting for connector to stabilise before retry...`);
        if (cfg.connectorId) {
          const { waitForConnector } = await import('./tallyConnectorServer.js');
          const connected = await waitForConnector(cfg.connectorId, 15000);
          if (!connected) {
            LOG(`  Connector still offline after 15s — retrying anyway`);
          } else {
            // Give the connector an extra 3s after socket reconnects so its
            // internal tally-request listener is fully registered on the new socket.
            await new Promise(r => setTimeout(r, 3000));
            LOG(`  Connector back online — retrying now`);
          }
        } else {
          await new Promise(r => setTimeout(r, 8000));
        }
      } else {
        const delay = 2000 * Math.pow(2, i);
        LOG(`  Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  ERR(`All ${attempts} attempts failed. Last error: ${lastErr?.message}`);
  throw lastErr;
}

// === XML REQUEST BUILDERS ===
function companyTag(cfg) {
  const co = (cfg.companyName || '').trim();
  return co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : '';
}

// Build Export Data XML for vouchers — uses proven "Day Book" report format
// This format matches what tallySyncStream.js uses (which was working)
function buildVoucherExportXml(cfg, fromDate = null, toDate = null) {
  const company = cfg.companyName || 'SRI CHAKRA INDUSTRIES';
  const fromTd = fromDate ? td(fromDate) : '';
  const toTd   = toDate   ? td(toDate)   : '';

  let dateVars = '';
  if (fromTd && toTd) {
    dateVars = `<SVFROMDATE>${fromTd}</SVFROMDATE><SVTODATE>${toTd}</SVTODATE>`;
  } else if (fromTd) {
    dateVars = `<SVFROMDATE>${fromTd}</SVFROMDATE>`;
  } else if (toTd) {
    dateVars = `<SVTODATE>${toTd}</SVTODATE>`;
  }

  // Use proven "Export Data" format with "Day Book" report — this matches what tallySyncStream.js uses
  return `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${dateVars}</STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
}

// Build a Day Book (Export Data) XML request that returns ALL vouchers for a date range.
// This is the ONLY Tally request format that returns ALLINVENTORYENTRIES.LIST and
// ALLLEDGERENTRIES.LIST reliably. The COLLECTION FETCH=* approach does NOT return sub-lists.
function buildAllVouchersCollectionXml(cfg, fromDate = null, toDate = null) {
  const company = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim();

  // IMPORTANT: Day Book "Export Data" is session-locked — Tally only returns vouchers
  // from its currently open screen context, not the full date range. It also completely
  // ignores SVFROMDATE/SVTODATE when Tally is busy or has a voucher open.
  //
  // Instead, use the TYPE=Collection format which:
  //  1. Works regardless of what screen Tally is on
  //  2. Correctly honours date range filters
  //  3. Returns ALLINVENTORYENTRIES.LIST and ALLLEDGERENTRIES.LIST with full item detail
  //
  // Confirmed working: fetched 1709 vouchers with items in a single request.

  let effectiveFrom = fromDate;
  let effectiveTo   = toDate;
  if (!effectiveFrom && !effectiveTo) {
    effectiveTo   = new Date();
    effectiveFrom = new Date(HISTORY_START_DATE); // April 1, 2024 — full history baseline
    LOG(`[AllVouchers] No date range — defaulting to full history window: ${td(effectiveFrom)} → ${td(effectiveTo)}`);
  }

  const fromTd = effectiveFrom ? td(effectiveFrom) : '';
  const toTd   = effectiveTo   ? td(effectiveTo)   : '';

  const dateVars = (fromTd && toTd)
    ? `<SVFROMDATE>${fromTd}</SVFROMDATE><SVTODATE>${toTd}</SVTODATE>`
    : fromTd ? `<SVFROMDATE>${fromTd}</SVFROMDATE>`
    : toTd   ? `<SVTODATE>${toTd}</SVTODATE>` : '';

  const coTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';

  return `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>AllVouchers</ID>
</HEADER>
<BODY>
  <DESC>
    <STATICVARIABLES>
      ${coTag}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${dateVars}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="AllVouchers">
        <TYPE>Voucher</TYPE>
        <FETCH>GUID, VoucherNumber, Date, PartyLedgerName, Amount, VoucherTypeName, Narration, ALLLEDGERENTRIES.LIST, ALLINVENTORYENTRIES.LIST, BILLTOLEDGERNAME, BILLTOADDRESS, BILLTOSTATE, BILLTOCOUNTRY, BILLTOPINCODE, BILLTOGSTIN, BILLTONAME, BILLTOMAILINGNAME, BILLTOCITY, BILLTOGSTREGISTRATIONTYPE, BASICBUYERNAME, BASICBUYERADDRESS, BASICBUYERADDRESS.LIST, BUYERNAME, BUYERADDRESS, BUYERCITY, BUYERSTATE, BUYERCOUNTRY, BUYERPINCODE, BUYERGSTIN, CONSIGNEENAME, CONSIGNEEADDRESS, CONSIGNEESTATE, CONSIGNEECOUNTRY, CONSIGNEEPINCODE, CONSIGNEEGSTIN, CONSIGNEEMAILINGNAME, CONSIGNEECITY, BASICSHIPTO, SHIPTONAME, SHIPTOADDRESS, SHIPTOSTATE, SHIPTOCOUNTRY, SHIPTOPINCODE, SHIPTOGSTIN, SHIPTOMAILINGNAME, SHIPTOCITY, DELIVERYNAME, DELIVERYADDRESS, DELIVERYADDRESS.LIST, PARTYSHIPPINGNAME, PARTYSHIPPINGADDRESS, $BillToAddress, $BillToAddress.LIST, $ShipToAddress, $ShipToAddress.LIST, $ConsigneeAddress, $ConsigneeAddress.LIST, PlaceOfSupply, PartyGSTIN, IRN, AckNo, AckDate, ReferenceNo, DeliveryNote, BuyersOrderNo, DispatchDocNo, DispatchedThrough, Destination, BillOfLadingNo, MotorVehicleNo, TermsOfDelivery</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC>
</BODY>
</ENVELOPE>`;
}

// Build Collection-based XML for ledgers — same pattern as StockItem/Voucher which are working.
// The "List of Accounts" Export Data report is unreliable across Tally versions.
// Using TYPE=Collection with Ledger is the only method confirmed to work.
function buildLedgerExportXml(cfg) {
  const company = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim();
  const coTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllLedgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${coTag}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllLedgers">
            <TYPE>Ledger</TYPE>
            <FETCH>Name, Parent, GUID, AlterID, GSTRegistrationDetails, OpeningBalance, ClosingBalance,
                   MailingName, Email, LedgerMobile, LedgerCity, LedgerState, StateName,
                   Pincode, CountryName, Address, GSTIN, PartyGSTIN, LedgerPhone,
                   Telephone, ContactPerson</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

// Build Collection-based XML for stock items.
// Uses TYPE=Collection with a dynamic TDL StockItem collection — avoids the
// non-existent "List of Stock Items" report that causes Tally to return an error.
function buildItemExportXml(cfg) {
  const company = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim();
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

// Dynamic TDL Collection builder that uses Type instead of hardcoded collection names.
// Uses SVFROMDATE / SVTODATE (Tally's native static variables) for date filtering —
// these are the ONLY reliable way to filter vouchers by date range in Tally TDL.
// The $$FilterByDate TDL formula is NOT valid syntax and has been removed.
function buildDynamicCollectionXml(cfg, tallyType, collectionName, voucherType = null, fromDate = null, toDate = null) {
  const fromTd = fromDate ? td(fromDate) : '';
  const toTd   = toDate   ? td(toDate)   : '';

  // Build date range static variables using Tally's SVFROMDATE / SVTODATE.
  // These are the ONLY reliable date filters for Voucher collections in Tally Prime / ERP 9.
  let dateVars = '';
  if (fromTd && toTd) {
    dateVars = `
     <SVFROMDATE>${fromTd}</SVFROMDATE>
     <SVTODATE>${toTd}</SVTODATE>`;
  } else if (fromTd) {
    dateVars = `
     <SVFROMDATE>${fromTd}</SVFROMDATE>`;
  } else if (toTd) {
    dateVars = `
     <SVTODATE>${toTd}</SVTODATE>`;
  }

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
     ${companyTag(cfg)}
     <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${dateVars}
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
}

// === PARSERS ===
function getSafeValue(obj, key, defaultValue = '') {
  if (!obj) return defaultValue;
  let value = obj[key];
  if (value === undefined || value === null) return defaultValue;
  // fast-xml-parser returns {#text: '...', @_TYPE: '...'} for tags with attributes
  // (e.g. <DATE TYPE="Date">20260401</DATE>)
  if (typeof value === 'object' && !Array.isArray(value)) {
    value = value['#text'] ?? value['_text'] ?? value['$t'] ?? '';
  }
  if (value === '' || value === null || value === undefined) return defaultValue;
  const str = String(value).replace(/[\r\n]+/g, ' ');
  // Reject Tally unexpanded TDL placeholders: ".", "..", "...", or any dot-only string
  if (/^\.+$/.test(str.trim())) return defaultValue;
  return str;
}

// Helper to recursively search an object for any of the given keys (case-insensitive)
function findFirstValue(obj, keys, defaultValue = '') {
  if (!obj) return defaultValue;
  
  // First check direct keys (case-insensitive)
  const objKeys = Object.keys(obj);
  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    const matchingKey = objKeys.find(k => k.toLowerCase() === lowerKey);
    if (matchingKey) {
      const value = obj[matchingKey];
      const safeVal = getSafeValue(obj, matchingKey);
      if (safeVal && safeVal.trim() !== '') {
        return safeVal;
      }
    }
  }
  
  // Recursively check nested objects
  for (const key of objKeys) {
    const value = obj[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const found = findFirstValue(value, keys, defaultValue);
      if (found && found !== defaultValue) {
        return found;
      }
    }
  }
  
  return defaultValue;
}

// Helper to extract BILL TO ADDRESS ONLY from parsed voucher object
function extractBillToAddressFromParsed(obj) {
  const lines = [];
  
  // Try BASICBUYERADDRESS.LIST first (most reliable buyer address in Tally)
  const basicBuyerAddrList = obj['BASICBUYERADDRESS.LIST'];
  if (basicBuyerAddrList) {
    const items = Array.isArray(basicBuyerAddrList) ? basicBuyerAddrList : [basicBuyerAddrList];
    items.forEach(item => {
      const line = getSafeValue(item, 'ADDRESS');
      if (line && !line.startsWith('<') && !line.startsWith('$')) {
        lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
      }
    });
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try $BillToAddress.LIST
  const dollarBillToList = obj['$BillToAddress.LIST'];
  if (dollarBillToList) {
    if (Array.isArray(dollarBillToList)) {
      dollarBillToList.forEach(item => {
        const line = getSafeValue(item, 'ADDRESS');
        if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
      });
    } else if (typeof dollarBillToList === 'object') {
      const innerAddr = dollarBillToList['ADDRESS'];
      if (Array.isArray(innerAddr)) {
        innerAddr.forEach(item => {
          const line = getSafeValue(item, 'ADDRESS');
          if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
        });
      } else {
        const line = getSafeValue(dollarBillToList, 'ADDRESS');
        if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
      }
    }
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try BILLTOADDRESS.LIST
  const billToAddressList = obj['BILLTOADDRESS.LIST'];
  if (billToAddressList) {
    if (Array.isArray(billToAddressList)) {
      billToAddressList.forEach(item => {
        const line = getSafeValue(item, 'ADDRESS');
        if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
      });
    } else if (typeof billToAddressList === 'object') {
      const innerAddr = billToAddressList['ADDRESS'];
      if (Array.isArray(innerAddr)) {
        innerAddr.forEach(item => {
          const line = getSafeValue(item, 'ADDRESS');
          if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
        });
      } else {
        const line = getSafeValue(billToAddressList, 'ADDRESS');
        if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
      }
    }
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try single $BillToAddress
  const dollarBillToAddr = getSafeValue(obj, '$BillToAddress');
  if (dollarBillToAddr) return decodeXmlEntities(dollarBillToAddr);
  
  // Try single BILLTOADDRESS
  const billToAddr = getSafeValue(obj, 'BILLTOADDRESS');
  if (billToAddr) return decodeXmlEntities(billToAddr);
  
  // Try single BASICBUYERADDRESS — only if it's actual text, not a TDL formula
  const basicBuyerAddr = getSafeValue(obj, 'BASICBUYERADDRESS');
  if (basicBuyerAddr && !basicBuyerAddr.startsWith('<') && !basicBuyerAddr.startsWith('$')) return decodeXmlEntities(basicBuyerAddr);
  
  return '';
}

// Helper to extract SHIP TO ADDRESS ONLY from parsed voucher object
function extractShipToAddressFromParsed(obj) {
  const lines = [];
  
  // Try $ShipToAddress.LIST first
  const dollarShipToList = obj['$ShipToAddress.LIST'];
  if (dollarShipToList) {
    if (Array.isArray(dollarShipToList)) {
      dollarShipToList.forEach(item => {
        const line = getSafeValue(item, 'ADDRESS');
        if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
      });
    } else if (typeof dollarShipToList === 'object') {
      const innerAddr = dollarShipToList['ADDRESS'];
      if (Array.isArray(innerAddr)) {
        innerAddr.forEach(item => {
          const line = getSafeValue(item, 'ADDRESS');
          if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
        });
      } else {
        const line = getSafeValue(dollarShipToList, 'ADDRESS');
        if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
      }
    }
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try SHIPTOADDRESS.LIST
  const shipToAddressList = obj['SHIPTOADDRESS.LIST'];
  if (shipToAddressList) {
    if (Array.isArray(shipToAddressList)) {
      shipToAddressList.forEach(item => {
        const line = getSafeValue(item, 'ADDRESS');
        if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
      });
    } else if (typeof shipToAddressList === 'object') {
      const innerAddr = shipToAddressList['ADDRESS'];
      if (Array.isArray(innerAddr)) {
        innerAddr.forEach(item => {
          const line = getSafeValue(item, 'ADDRESS');
          if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
        });
      } else {
        const line = getSafeValue(shipToAddressList, 'ADDRESS');
        if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
      }
    }
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try $ConsigneeAddress.LIST
  const dollarConsigneeList = obj['$ConsigneeAddress.LIST'];
  if (dollarConsigneeList) {
    if (Array.isArray(dollarConsigneeList)) {
      dollarConsigneeList.forEach(item => {
        const line = getSafeValue(item, 'ADDRESS');
        if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
      });
    } else if (typeof dollarConsigneeList === 'object') {
      const innerAddr = dollarConsigneeList['ADDRESS'];
      if (Array.isArray(innerAddr)) {
        innerAddr.forEach(item => {
          const line = getSafeValue(item, 'ADDRESS');
          if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
        });
      } else {
        const line = getSafeValue(dollarConsigneeList, 'ADDRESS');
        if (line) lines.push(decodeXmlEntities(line.replace(/[\r\n]+/g, ' ')));
      }
    }
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try single $ShipToAddress
  const dollarShipToAddr = getSafeValue(obj, '$ShipToAddress');
  if (dollarShipToAddr) return decodeXmlEntities(dollarShipToAddr);
  
  // Try single SHIPTOADDRESS
  const shipToAddr = getSafeValue(obj, 'SHIPTOADDRESS');
  if (shipToAddr) return decodeXmlEntities(shipToAddr);
  
  // Try single CONSIGNEEADDRESS
  const consigneeAddr = getSafeValue(obj, 'CONSIGNEEADDRESS');
  if (consigneeAddr) return decodeXmlEntities(consigneeAddr);
  
  // Try single DELIVERYADDRESS
  const deliveryAddr = getSafeValue(obj, 'DELIVERYADDRESS');
  if (deliveryAddr) return decodeXmlEntities(deliveryAddr);
  
  return '';
}

// ------------------------------
// SEPARATE MAP BILL TO FROM PARSED OBJECT
// ------------------------------
function mapBillToFromParsed(voucher) {
  const billTo = {
    name: '',
    mailingName: '',
    address: '',
    city: '',
    state: '',
    country: '',
    pincode: '',
    gstin: '',
    gstRegType: ''
  };
  
  // Name - BILL TO ONLY
  // IMPORTANT: BASICBUYERNAME / BUYERNAME intentionally skipped — Tally puts the
  // CONSIGNEE name in those fields for inter-state invoices.
  const billToName = getSafeValue(voucher, 'BILLTONAME');
  if (billToName) billTo.name = billToName;

  const billToLedgerName = getSafeValue(voucher, 'BILLTOLEDGERNAME');
  if (!billTo.name && billToLedgerName) billTo.name = billToLedgerName;

  // ── KEY FIX: Tally TDL Collection format does NOT populate BILLTONAME / BASICBUYERNAME.
  // The actual buyer (Bill To) is the first ALLLEDGERENTRIES.LIST entry with ISDEEMEDPOSITIVE=Yes.
  // Also: BASICBUYERNAME/BUYERNAME sometimes contain the consignee name — skip those if they
  // match a known ship-to name.
  if (!billTo.name) {
    // Pre-read ship-to names to avoid using them as bill-to
    const knownShipNames = new Set(
      [getSafeValue(voucher, 'CONSIGNEENAME'), getSafeValue(voucher, 'SHIPTONAME')]
        .filter(Boolean).map(s => s.trim().toLowerCase())
    );
    const ledgerList = voucher['ALLLEDGERENTRIES.LIST'] || voucher['LEDGERENTRIES.LIST'] || [];
    const ledgerArr = Array.isArray(ledgerList) ? ledgerList : [ledgerList];
    for (const le of ledgerArr) {
      const isDeemedPositive = getSafeValue(le, 'ISDEEMEDPOSITIVE');
      if (isDeemedPositive === 'Yes') {
        const ledgerName = getSafeValue(le, 'LEDGERNAME');
        if (ledgerName && !knownShipNames.has(ledgerName.trim().toLowerCase())) {
          billTo.name = ledgerName;
          break;
        }
      }
    }
  }
  
  // Mailing name - BILL TO ONLY
  const billToMailingName = getSafeValue(voucher, 'BILLTOMAILINGNAME');
  if (billToMailingName) billTo.mailingName = billToMailingName;
  
  // Address - BILL TO ONLY
  billTo.address = extractBillToAddressFromParsed(voucher);
  
  // City - BILL TO ONLY
  const billToCity = getSafeValue(voucher, 'BILLTOCITY');
  if (billToCity) billTo.city = billToCity;
  
  // State - BILL TO ONLY
  const billToState = getSafeValue(voucher, 'BILLTOSTATE');
  if (billToState) billTo.state = billToState;
  
  // Country - BILL TO ONLY
  const billToCountry = getSafeValue(voucher, 'BILLTOCOUNTRY');
  if (billToCountry) billTo.country = billToCountry;
  
  // Pincode - BILL TO ONLY
  // NOTE: BILLTOPINCODE in Tally vouchers can hold sequential internal counters
  // instead of the actual party pincode (Tally bug/misuse). We skip it entirely
  // and rely on the pincode extracted from the address text by extractBillToAddressFromParsed.
  // The address parser in parseTallyAddress already extracts 6-digit pincodes from address lines.
  // (billTo.pincode left as '' here — populated via backfillBillToFromLedger if needed)
  
  // GSTIN - BILL TO ONLY
  const billToGstin = getSafeValue(voucher, 'BILLTOGSTIN');
  if (billToGstin) billTo.gstin = billToGstin;
  
  // GST Reg Type - BILL TO ONLY
  const billToGstRegType = getSafeValue(voucher, 'BILLTOGSTREGISTRATIONTYPE');
  if (billToGstRegType) billTo.gstRegType = billToGstRegType;
  
  return billTo;
}

// ------------------------------
// SEPARATE MAP SHIP TO FROM PARSED OBJECT
// ------------------------------
function mapShipToFromParsed(voucher) {
  const shipTo = {
    name: '',
    mailingName: '',
    address: '',
    city: '',
    state: '',
    country: '',
    pincode: '',
    gstin: ''
  };
  
  // Name - SHIP TO ONLY
  const shipToName = getSafeValue(voucher, 'SHIPTONAME');
  if (shipToName) shipTo.name = shipToName;
  
  const basicShipTo = getSafeValue(voucher, 'BASICSHIPTO');
  if (!shipTo.name && basicShipTo) shipTo.name = basicShipTo;
  
  const consigneeName = getSafeValue(voucher, 'CONSIGNEENAME');
  if (!shipTo.name && consigneeName) shipTo.name = consigneeName;
  
  const deliveryName = getSafeValue(voucher, 'DELIVERYNAME');
  if (!shipTo.name && deliveryName) shipTo.name = deliveryName;
  
  const partyShippingName = getSafeValue(voucher, 'PARTYSHIPPINGNAME');
  if (!shipTo.name && partyShippingName) shipTo.name = partyShippingName;
  
  // Mailing name - SHIP TO ONLY
  const shipToMailingName = getSafeValue(voucher, 'SHIPTOMAILINGNAME');
  if (shipToMailingName) shipTo.mailingName = shipToMailingName;
  
  const consigneeMailingName = getSafeValue(voucher, 'CONSIGNEEMAILINGNAME');
  if (!shipTo.mailingName && consigneeMailingName) shipTo.mailingName = consigneeMailingName;
  
  // Address - SHIP TO ONLY
  shipTo.address = extractShipToAddressFromParsed(voucher);
  
  // City - SHIP TO ONLY
  const shipToCity = getSafeValue(voucher, 'SHIPTOCITY');
  if (shipToCity) shipTo.city = shipToCity;
  
  const consigneeCity = getSafeValue(voucher, 'CONSIGNEECITY');
  if (!shipTo.city && consigneeCity) shipTo.city = consigneeCity;
  
  // State - SHIP TO ONLY
  const shipToState = getSafeValue(voucher, 'SHIPTOSTATE');
  if (shipToState) shipTo.state = shipToState;
  
  const consigneeState = getSafeValue(voucher, 'CONSIGNEESTATE');
  if (!shipTo.state && consigneeState) shipTo.state = consigneeState;
  
  // Country - SHIP TO ONLY
  const shipToCountry = getSafeValue(voucher, 'SHIPTOCOUNTRY');
  if (shipToCountry) shipTo.country = shipToCountry;
  
  const consigneeCountry = getSafeValue(voucher, 'CONSIGNEECOUNTRY');
  if (!shipTo.country && consigneeCountry) shipTo.country = consigneeCountry;
  
  // Pincode - SHIP TO ONLY
  const shipToPincode = getSafeValue(voucher, 'SHIPTOPINCODE');
  if (shipToPincode) shipTo.pincode = shipToPincode;
  
  const consigneePincode = getSafeValue(voucher, 'CONSIGNEEPINCODE');
  if (!shipTo.pincode && consigneePincode) shipTo.pincode = consigneePincode;
  
  // GSTIN - SHIP TO ONLY
  const shipToGstin = getSafeValue(voucher, 'SHIPTOGSTIN');
  if (shipToGstin) shipTo.gstin = shipToGstin;
  
  const consigneeGstin = getSafeValue(voucher, 'CONSIGNEEGSTIN');
  if (!shipTo.gstin && consigneeGstin) shipTo.gstin = consigneeGstin;
  
  return shipTo;
}

// Helper to extract GST rate from voucher, inventory entries, or tax ledgers
function extractGstRate(voucher, inventoryEntry = null, taxLines = []) {
  // 1. Check RATEDETAILS, GSTDETAILS, TAXRATE, RATE, GSTRATE in voucher
  const rateDetails = findFirstValue(voucher, ['RATEDETAILS', 'GSTDETAILS', 'TAXRATE', 'RATE', 'GSTRATE']);
  if (rateDetails) {
    const match = String(rateDetails).match(/(\d+(?:\.\d+)?)\s*%?/);
    if (match) {
      return parseFloat(match[1]);
    }
  }
  
  // 2. Check inventory entry's GST details if provided
  if (inventoryEntry) {
    const invRate = findFirstValue(inventoryEntry, ['RATEDETAILS', 'GSTDETAILS', 'TAXRATE', 'GSTRATE', 'RATE']);
    if (invRate) {
      const match = String(invRate).match(/(\d+(?:\.\d+)?)\s*%?/);
      if (match) {
        return parseFloat(match[1]);
      }
    }
  }
  
  // 3. Extract from tax ledger names (common patterns: "CGST 9%", "SGST @ 6%", etc.)
  for (const line of taxLines) {
    const ledgerName = String(line.ledgerName || '');
    const match = ledgerName.match(/(\d+(?:\.\d+)?)\s*%/);
    if (match) {
      // For CGST/SGST, the total rate is double (since they're half each)
      if (ledgerName.toLowerCase().includes('cgst') || ledgerName.toLowerCase().includes('sgst') || ledgerName.toLowerCase().includes('utgst')) {
        return parseFloat(match[1]) * 2;
      }
      return parseFloat(match[1]);
    }
  }
  
  // 4. Fall back to 0 (never calculate from amounts)
  return 0;
}

function getSafeNumber(obj, key, defaultValue = 0) {
  if (!obj) return defaultValue;
  const raw = getSafeValue(obj, key, '');
  if (!raw) return defaultValue;
  const num = parseFloat(raw.replace(/[^\d.-]/g, ''));
  return isNaN(num) ? defaultValue : num;
}

function parseStockItems(xml) {
  const items = [];
  const failed = [];
  try {
    const parsed = xmlParser.parse(xml);
    let stockItems = [];
    
    // Find stock items in different possible paths
    if (parsed.ENVELOPE && parsed.ENVELOPE.BODY && parsed.ENVELOPE.BODY.DATA && parsed.ENVELOPE.BODY.DATA.COLLECTION) {
      stockItems = parsed.ENVELOPE.BODY.DATA.COLLECTION.STOCKITEM || [];
    } else if (parsed.ENVELOPE && parsed.ENVELOPE.BODY && parsed.ENVELOPE.BODY.DATA) {
      stockItems = parsed.ENVELOPE.BODY.DATA.STOCKITEM || [];
    } else if (parsed.STOCKITEM) {
      stockItems = Array.isArray(parsed.STOCKITEM) ? parsed.STOCKITEM : [parsed.STOCKITEM];
    }
    
    // Ensure we always work with an array
    if (!Array.isArray(stockItems)) {
      stockItems = [stockItems];
    }

    LOG(`[parseStockItems] Total XML records found: ${stockItems.length}`);
    if (stockItems.length > 0) {
      LOG(`[parseStockItems] First parsed record: ${JSON.stringify(stockItems[0]).slice(0, 500)}`);
    }

    for (const item of stockItems) {
      let name = '';
      // Try different name fields
      name = getSafeValue(item, '@_NAME') || 
             getSafeValue(item, 'STOCKITEMNAME') ||
             getSafeValue(item, 'NAME');
      
      if (!name) {
        failed.push({ reason: 'No name found', item: JSON.stringify(item).slice(0, 200) });
        continue;
      }

      const guid = getSafeValue(item, 'GUID');
      const alterId = getSafeValue(item, 'ALTERID');
      const hsn = getSafeValue(item, 'HSNCODE');
      const gst = getSafeNumber(item, 'GSTRATE');
      const unit = getSafeValue(item, 'BASEUNITS', 'Nos');
      const cost = getSafeNumber(item, 'STANDARDCOST');
      const openingStock = getSafeNumber(item, 'OPENINGBALANCE');
      const openingValue = getSafeNumber(item, 'OPENINGVALUE');
      const closingBalance = getSafeValue(item, 'CLOSINGBALANCE') || getSafeValue(item, 'CLOSINGSTOCK') || '0';
      const closingValue = getSafeValue(item, 'CLOSINGVALUE') || '0';
      const gstApplicable = getSafeValue(item, 'GSTAPPLICABLE');
      
      items.push({ name, guid, alterId, hsn, gst, unit, cost, openingStock, openingValue, closingBalance, closingValue, gstApplicable, rawData: item });
    }
  } catch (e) {
    ERR('Error parsing stock items', e);
  }
  
  LOG(`[parseStockItems] Valid records: ${items.length}, Skipped records: ${failed.length}`);
  if (failed.length > 0) {
    LOG(`[parseStockItems] Skipped reasons: ${JSON.stringify(failed)}`);
  }
  return items;
}

function parseTallyAddress(ledger) {
  const lines = [];
  if (ledger.ADDRESS) {
    if (Array.isArray(ledger.ADDRESS)) {
      lines.push(...ledger.ADDRESS.map(a => decodeXmlEntities(String(a).trim())));
    } else {
      lines.push(decodeXmlEntities(String(ledger.ADDRESS).trim()));
    }
  }
  
  const city = decodeXmlEntities(getSafeValue(ledger, 'LEDGERCITY'));
  const state = decodeXmlEntities(
    getSafeValue(ledger, 'STATENAME') ||
    getSafeValue(ledger, 'LEDSTATENAME') ||
    getSafeValue(ledger, 'LEDGERSTATE') ||
    getSafeValue(ledger, 'STATE') ||
    ''
  );
  const pincode = decodeXmlEntities(getSafeValue(ledger, 'PINCODE') || getSafeValue(ledger, 'LEDGERPINCODE'));
  const country = decodeXmlEntities(getSafeValue(ledger, 'COUNTRYNAME'));

  const streetLines = lines.slice(0, 2);
  const street = streetLines.join(', ');
  let derivedCity = city;
  let derivedState = state;
  let derivedPincode = pincode;

  if (!derivedCity || !derivedState) {
    for (const line of lines) {
      const pinMatch = line.match(/\b(\d{6})\b/);
      if (pinMatch) {
        if (!derivedPincode) derivedPincode = pinMatch[1];
        const withoutPin = line.replace(pinMatch[0], '').replace(/[-,\s]+$/, '').trim();
        const parts = withoutPin.split(/[-,]/).map(p => p.trim()).filter(Boolean);
        if (!derivedCity && parts[0]) derivedCity = parts[0];
        if (!derivedState && parts[1]) derivedState = parts[1];
        break;
      }
    }
  }

  return { 
    address: street || lines.join(', '), 
    city: derivedCity, 
    state: derivedState, 
    pincode: derivedPincode.replace(/\D/g, '').slice(0, 6) || '', 
    country: country || 'India' 
  };
}

function parseLedgers(xml) {
  const ledgers = [];
  const failed = [];
  try {
    const parsed = xmlParser.parse(xml);
    let ledgerList = [];

    // Log raw structure immediately so we can diagnose path issues
    LOG(`[parseLedgers] Parsed envelope keys: ${Object.keys(parsed.ENVELOPE || parsed).join(', ')}`);
    if (parsed.ENVELOPE?.BODY?.DATA) {
      LOG(`[parseLedgers] DATA keys: ${Object.keys(parsed.ENVELOPE.BODY.DATA).join(', ')}`);
    }
    if (parsed.ENVELOPE?.BODY?.DATA?.COLLECTION) {
      LOG(`[parseLedgers] COLLECTION keys: ${Object.keys(parsed.ENVELOPE.BODY.DATA.COLLECTION).join(', ')}`);
    }

    // Find ledgers in all known Tally response structures.
    if (parsed.ENVELOPE?.BODY?.DATA?.COLLECTION?.LEDGER) {
      // Collection request (primary path — used by our new buildLedgerExportXml)
      ledgerList = parsed.ENVELOPE.BODY.DATA.COLLECTION.LEDGER;
      LOG(`[parseLedgers] Using path: ENVELOPE.BODY.DATA.COLLECTION.LEDGER`);
    } else if (parsed.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE?.LEDGER) {
      // Export Data (List of Accounts)
      ledgerList = parsed.ENVELOPE.BODY.DATA.TALLYMESSAGE.LEDGER;
      LOG(`[parseLedgers] Using path: ENVELOPE.BODY.DATA.TALLYMESSAGE.LEDGER`);
    } else if (parsed.ENVELOPE?.BODY?.DATA?.LEDGER) {
      ledgerList = parsed.ENVELOPE.BODY.DATA.LEDGER;
      LOG(`[parseLedgers] Using path: ENVELOPE.BODY.DATA.LEDGER`);
    } else if (parsed.ENVELOPE?.TALLYMESSAGE?.LEDGER) {
      ledgerList = parsed.ENVELOPE.TALLYMESSAGE.LEDGER;
      LOG(`[parseLedgers] Using path: ENVELOPE.TALLYMESSAGE.LEDGER`);
    } else if (parsed.TALLYMESSAGE?.LEDGER) {
      ledgerList = parsed.TALLYMESSAGE.LEDGER;
      LOG(`[parseLedgers] Using path: TALLYMESSAGE.LEDGER`);
    } else if (parsed.LEDGER) {
      ledgerList = parsed.LEDGER;
      LOG(`[parseLedgers] Using path: root.LEDGER`);
    } else {
      // Deep scan — walk all nested objects looking for a LEDGER array
      const deepFind = (obj, depth = 0) => {
        if (depth > 6 || !obj || typeof obj !== 'object') return null;
        if (Array.isArray(obj)) return null;
        for (const key of Object.keys(obj)) {
          if (key === 'LEDGER') {
            const val = obj[key];
            if (Array.isArray(val) && val.length > 0) return val;
            if (val && typeof val === 'object' && val.NAME) return [val];
          }
          const found = deepFind(obj[key], depth + 1);
          if (found) return found;
        }
        return null;
      };
      const found = deepFind(parsed);
      if (found) {
        ledgerList = found;
        LOG(`[parseLedgers] Using deep-scan fallback, found ${found.length} ledgers`);
      } else {
        LOG(`[parseLedgers] ⚠️ Could not find LEDGER in any known path. Full parsed keys: ${JSON.stringify(Object.keys(parsed))}`);
      }
    }
    
    // Ensure array
    if (!ledgerList) {
      ledgerList = [];
    } else if (!Array.isArray(ledgerList)) {
      ledgerList = [ledgerList];
    }

    LOG(`[parseLedgers] Total ledgers fetched from Tally: ${ledgerList.length}`);
    if (ledgerList.length > 0) {
      LOG(`[parseLedgers] First parsed record keys: ${Object.keys(ledgerList[0]).join(', ')}`);
      LOG(`[parseLedgers] First parsed record: ${JSON.stringify(ledgerList[0]).slice(0, 600)}`);
    }

    for (const ledger of ledgerList) {
      let name = '';
      // Try different name fields
      name = decodeXmlEntities(getSafeValue(ledger, '@_NAME')) || 
             decodeXmlEntities(getSafeValue(ledger, 'LEDGERNAME')) ||
             decodeXmlEntities(getSafeValue(ledger, 'NAME')) ||
             decodeXmlEntities(getSafeValue(ledger, 'LEDGSTNAME')) ||
             decodeXmlEntities(getSafeValue(ledger, 'MAILINGNAME'));
      
      if (!name) {
        failed.push({ reason: 'No name found', ledger: JSON.stringify(ledger).slice(0, 200) });
        continue;
      }

      const parent = decodeXmlEntities(getSafeValue(ledger, 'PARENT'));
      const parentNorm = parent?.trim().toLowerCase() || '';
      const guid = getSafeValue(ledger, 'GUID');
      const alterId = getSafeValue(ledger, 'ALTERID');
      const gstNumber = decodeXmlEntities(getSafeValue(ledger, 'GSTIN') || getSafeValue(ledger, 'PARTYGSTIN'));
      const openingBalance = getSafeNumber(ledger, 'OPENINGBALANCE');
      const closingBalance = getSafeNumber(ledger, 'CLOSINGBALANCE') || openingBalance;
      // Try multiple email fields
      const email = decodeXmlEntities(
        getSafeValue(ledger, 'EMAIL') ||
        getSafeValue(ledger, 'LEDGEREMAIL') ||
        getSafeValue(ledger, 'MAILINGEMAIL') ||
        ''
      );
      // Try multiple phone number fields!
      const phone = decodeXmlEntities(
        getSafeValue(ledger, 'LEDGERMOBILE') ||
        getSafeValue(ledger, 'MOBILE') ||
        getSafeValue(ledger, 'MOBILENO') ||
        getSafeValue(ledger, 'TELEPHONE') ||
        getSafeValue(ledger, 'PHONE') ||
        getSafeValue(ledger, 'PHONENO') ||
        getSafeValue(ledger, 'CONTACT') ||
        ''
      );
      const contactPerson = decodeXmlEntities(
        getSafeValue(ledger, 'MAILINGNAME') ||
        getSafeValue(ledger, 'CONTACTPERSON') ||
        getSafeValue(ledger, 'PERSON') ||
        ''
      );
      const isCreditor = parentNorm.includes('sundry creditor') || parentNorm === 'sundry creditors';
      const isDebtor   = parentNorm.includes('sundry debtor')   || parentNorm === 'sundry debtors';
      const addrInfo = parseTallyAddress(ledger);
      
      ledgers.push({ 
        name, 
        guid, 
        alterId, 
        gstNumber, 
        openingBalance,
        closingBalance,
        email, 
        phone, 
        contactPerson, 
        isCreditor, 
        isDebtor,
        parent,
        parentNorm,
        ...addrInfo,
        // Ensure state has the richest possible value — addrInfo already tries
        // STATENAME / LEDSTATENAME / LEDGERSTATE / STATE via parseTallyAddress,
        // but fall back to direct ledger fields if addrInfo came up empty.
        state: addrInfo.state ||
               decodeXmlEntities(getSafeValue(ledger, 'STATENAME')) ||
               decodeXmlEntities(getSafeValue(ledger, 'LEDSTATENAME')) ||
               decodeXmlEntities(getSafeValue(ledger, 'LEDGERSTATE')) ||
               decodeXmlEntities(getSafeValue(ledger, 'STATE')) ||
               '',
        rawData: ledger
      });
    }
  } catch (e) {
    ERR('Error parsing ledgers', e);
  }
  
  // Debug: log all unique parent groups found
  const parentGroups = [...new Set(ledgers.map(l => l.parent).filter(Boolean))];
  LOG(`[parseLedgers] Parent groups found: ${parentGroups.join(' | ') || '(none)'}`);
  LOG(`[parseLedgers] Suppliers (Sundry Creditors): ${ledgers.filter(l => l.isCreditor).length}`);
  LOG(`[parseLedgers] Clients (Sundry Debtors): ${ledgers.filter(l => l.isDebtor).length}`);
  LOG(`[parseLedgers] Valid records: ${ledgers.length}, Skipped records: ${failed.length}`);
  if (failed.length > 0) {
    LOG(`[parseLedgers] Skipped reasons: ${JSON.stringify(failed)}`);
  }
  return ledgers;
}

function normaliseTallyPhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 10 ? digits : '';
}

function ledgersToOps(ledgers) {
  const ledgerOps = [], vendorOps = [], clientOps = [];
  for (const l of ledgers) {
    const { name, guid, alterId, gstNumber, openingBalance, closingBalance, email, phone, contactPerson, isCreditor, isDebtor, parent, address, city, state, pincode, country } = l;
    if (!guid) {
      LOG('Skipping ledger without GUID:', name);
      continue;
    }
    const ledgerGroup = parent || (isCreditor ? 'Sundry Creditors' : (isDebtor ? 'Sundry Debtors' : 'Primary'));
    const ledgerCode = `TALLY-${guid.replace(/[^A-Z0-9]/gi, '')}`;
    const lFilter = { tallyGuid: guid };
    const cleanPhone = normaliseTallyPhone(phone);
    const rawDigits = phone ? String(phone).replace(/\D/g, '').slice(0, 15) : '';
    const safePhone = cleanPhone || '';
    const safeEmail = email || `${name.replace(/\s+/g, '').toLowerCase().slice(0, 30)}@tally.sync`;
    // Use Tally closing balance if available; fall back to opening balance so UI never shows ₹0
    const safeClosingBalance = (closingBalance && closingBalance !== 0) ? closingBalance : openingBalance;

    ledgerOps.push({
      updateOne: {
        filter: lFilter,
        update: {
          $set: {
            tallyGuid: guid,
            tallyAlterId: alterId,
            ledgerName: name,
            groupName: ledgerGroup,
            partyName: contactPerson,
            gstNo: gstNumber,
            state,
            ledgerGroup, gstNumber, openingBalance,
            closingBalance: safeClosingBalance,
            closingBalanceCalculatedAt: new Date(),
            syncedWithTally: true, lastTallySync: new Date(),
            dataSource: 'Tally',  // mark as imported from Tally — never export back
            ...(email ? { email } : {}),
            ...(cleanPhone ? { phone: cleanPhone } : (rawDigits ? { phone: rawDigits } : {})),
            ...(address ? { 'address.street': address } : {}),
            ...(city ? { 'address.city': city } : {}),
            ...(state ? { 'address.state': state } : {}),
            ...(pincode ? { 'address.pincode': pincode } : {}),
            ...(country ? { 'address.country': country } : {})
          },
          $setOnInsert: { ledgerCode, contactPerson: contactPerson || name, panNumber: 'N/A', isActive: true }
        },
        upsert: true
      }
    });

    if (isCreditor) {
      vendorOps.push({
        updateOne: {
          filter: { tallyGuid: guid },
          update: {
            $set: {
              tallyGuid: guid,
              tallyAlterId: alterId,
              tallySynced: true, lastTallySync: new Date(),
              dataSource: 'Tally',  // mark as imported from Tally — never export back
              phone: safePhone, email: safeEmail, contactPerson: contactPerson || name,
              address: address || 'Imported from Tally',
              ...(city ? { city } : {}),
              ...(state ? { state } : {}),
              pincode: pincode || '000000',
              ...(gstNumber ? { gstNumber } : {})
            },
            $setOnInsert: {
              vendorId: `VND-TALLY-${guid.replace(/[^A-Z0-9]/gi, '')}`,
              companyName: name, category: 'General', status: 'Active'
            }
          },
          upsert: true
        }
      });
    } else if (isDebtor) {
      clientOps.push({
        updateOne: {
          filter: { tallyGuid: guid },
          update: {
            $set: {
              tallyGuid: guid,
              tallyAlterId: alterId,
              tallySynced: true, lastTallySync: new Date(),
              dataSource: 'Tally',  // mark as imported from Tally — never export back
              phone: safePhone, email: safeEmail, contact: contactPerson || name,
              address: address || 'Imported from Tally',
              ...(city ? { city } : {}),
              ...(state ? { state } : {}),
              pincode: pincode || '000000',
              ...(gstNumber ? { gstNumber } : {})
            },
            $setOnInsert: {
              clientId: `CLT-TALLY-${guid.replace(/[^A-Z0-9]/gi, '')}`,
              name, category: 'Trading', status: 'Active'
            }
          },
          upsert: true
        }
      });
    }
  }
  return { ledgerOps, vendorOps, clientOps };
}

// ── Regex-based helper to extract a single tag value from a raw XML block ──
function gTagVal(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  const val = decodeXmlEntities(m[1].trim());
  // Reject Tally unexpanded TDL placeholders: ".", "..", "...", or any dot-only string
  if (/^\.+$/.test(val)) return '';
  return val;
}

// Helper to extract address for BILL TO ONLY - no ship to logic here
function extractBillToAddressOnly(block) {
  const lines = [];
  
  // Try BASICBUYERADDRESS.LIST first (most reliable for buyer address)
  const basicBuyerAddrListPattern = /<BASICBUYERADDRESS\.LIST[^>]*>([\s\S]*?)<\/BASICBUYERADDRESS\.LIST>/gi;
  for (const match of [...block.matchAll(basicBuyerAddrListPattern)]) {
    const listContent = match[1];
    const addressMatches = [...listContent.matchAll(/<ADDRESS[^>]*>([\s\S]*?)<\/ADDRESS>/gi)];
    for (const addrMatch of addressMatches) {
      const line = decodeXmlEntities(addrMatch[1].trim());
      if (line && !line.startsWith('<') && !line.startsWith('$')) lines.push(line);
    }
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try $BillToAddress.LIST
  const billToListPattern = /<\$BillToAddress\.LIST[^>]*>([\s\S]*?)<\/\$BillToAddress\.LIST>/gi;
  for (const match of [...block.matchAll(billToListPattern)]) {
    const listContent = match[1];
    const addressMatches = [...listContent.matchAll(/<ADDRESS[^>]*>([\s\S]*?)<\/ADDRESS>/gi)];
    for (const addrMatch of addressMatches) {
      lines.push(decodeXmlEntities(addrMatch[1].trim()));
    }
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try BILLTOADDRESS.LIST
  const billToAddressListPattern = /<BILLTOADDRESS\.LIST[^>]*>([\s\S]*?)<\/BILLTOADDRESS\.LIST>/gi;
  for (const match of [...block.matchAll(billToAddressListPattern)]) {
    const listContent = match[1];
    const addressMatches = [...listContent.matchAll(/<ADDRESS[^>]*>([\s\S]*?)<\/ADDRESS>/gi)];
    for (const addrMatch of addressMatches) {
      lines.push(decodeXmlEntities(addrMatch[1].trim()));
    }
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try single $BillToAddress
  const singleBillToAddr = gTagVal(block, '$BillToAddress');
  if (singleBillToAddr) return singleBillToAddr;
  
  // Try single BILLTOADDRESS
  const singleBillToAddress = gTagVal(block, 'BILLTOADDRESS');
  if (singleBillToAddress) return singleBillToAddress;
  
  // Try single BASICBUYERADDRESS — but only if it's real text, not a TDL formula reference
  const basicBuyerAddress = gTagVal(block, 'BASICBUYERADDRESS');
  if (basicBuyerAddress && !basicBuyerAddress.startsWith('<') && !basicBuyerAddress.startsWith('$')) return basicBuyerAddress;
  
  return '';
}

// Helper to extract address for SHIP TO ONLY - no bill to logic here
function extractShipToAddressOnly(block) {
  const lines = [];
  
  // Try $ShipToAddress.LIST
  const shipToListPattern = /<\$ShipToAddress\.LIST[^>]*>([\s\S]*?)<\/\$ShipToAddress\.LIST>/gi;
  for (const match of [...block.matchAll(shipToListPattern)]) {
    const listContent = match[1];
    const addressMatches = [...listContent.matchAll(/<ADDRESS[^>]*>([\s\S]*?)<\/ADDRESS>/gi)];
    for (const addrMatch of addressMatches) {
      lines.push(decodeXmlEntities(addrMatch[1].trim()));
    }
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try SHIPTOADDRESS.LIST
  const shipToAddressListPattern = /<SHIPTOADDRESS\.LIST[^>]*>([\s\S]*?)<\/SHIPTOADDRESS\.LIST>/gi;
  for (const match of [...block.matchAll(shipToAddressListPattern)]) {
    const listContent = match[1];
    const addressMatches = [...listContent.matchAll(/<ADDRESS[^>]*>([\s\S]*?)<\/ADDRESS>/gi)];
    for (const addrMatch of addressMatches) {
      lines.push(decodeXmlEntities(addrMatch[1].trim()));
    }
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try $ConsigneeAddress.LIST
  const consigneeListPattern = /<\$ConsigneeAddress\.LIST[^>]*>([\s\S]*?)<\/\$ConsigneeAddress\.LIST>/gi;
  for (const match of [...block.matchAll(consigneeListPattern)]) {
    const listContent = match[1];
    const addressMatches = [...listContent.matchAll(/<ADDRESS[^>]*>([\s\S]*?)<\/ADDRESS>/gi)];
    for (const addrMatch of addressMatches) {
      lines.push(decodeXmlEntities(addrMatch[1].trim()));
    }
  }
  if (lines.length > 0) return lines.join(', ');
  
  // Try single $ShipToAddress
  const singleShipToAddr = gTagVal(block, '$ShipToAddress');
  if (singleShipToAddr) return singleShipToAddr;
  
  // Try single SHIPTOADDRESS
  const singleShipToAddress = gTagVal(block, 'SHIPTOADDRESS');
  if (singleShipToAddress) return singleShipToAddress;
  
  // Try single CONSIGNEEADDRESS
  const consigneeAddress = gTagVal(block, 'CONSIGNEEADDRESS');
  if (consigneeAddress) return consigneeAddress;
  
  // Try single DELIVERYADDRESS
  const deliveryAddress = gTagVal(block, 'DELIVERYADDRESS');
  if (deliveryAddress) return deliveryAddress;
  
  return '';
}

// ------------------------------
// SEPARATE MAP BILL TO FUNCTION
// ------------------------------
// No ship to logic, no fallbacks to ship to, completely independent
function mapBillToFromRaw(block) {
  const billTo = {
    name: '',
    mailingName: '',
    address: '',
    city: '',
    state: '',
    country: '',
    pincode: '',
    gstin: '',
    gstRegType: ''
  };

  // Pre-read ship-to names (used to detect when CONSIGNEENAME accidentally appears in bill-to tags)
  const consigneeName  = gTagVal(block, 'CONSIGNEENAME');
  const shipToName     = gTagVal(block, 'SHIPTONAME');
  const knownShipNames = new Set(
    [consigneeName, shipToName].filter(Boolean).map(s => s.trim().toLowerCase())
  );

  // Name fields - BILL TO ONLY
  // IMPORTANT: BASICBUYERNAME and BUYERNAME are intentionally NOT used here.
  // Tally puts the CONSIGNEE (ship-to/delivery party) name in those fields for
  // inter-state invoices — using them would show the wrong party as Bill To.
  // Only use explicit BILLTONAME and BILLTOLEDGERNAME tags.
  const billToNameTag = gTagVal(block, 'BILLTONAME');
  if (billToNameTag) billTo.name = billToNameTag;

  const billToLedgerName = gTagVal(block, 'BILLTOLEDGERNAME');
  if (!billTo.name && billToLedgerName) billTo.name = billToLedgerName;

  // ── Fallback: first ALLLEDGERENTRIES.LIST with ISDEEMEDPOSITIVE=Yes is the buyer ledger ──
  // This is reliable even when explicit BILLTONAME is absent (common in TDL Collection).
  // Skip the entry if its ledger name is the known ship-to party.
  if (!billTo.name) {
    const allLedgerPattern = /<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi;
    for (const m of block.matchAll(allLedgerPattern)) {
      const lb = m[1];
      if (gTagVal(lb, 'ISDEEMEDPOSITIVE') === 'Yes') {
        const ledgerName = gTagVal(lb, 'LEDGERNAME');
        if (ledgerName && !knownShipNames.has(ledgerName.trim().toLowerCase())) {
          billTo.name = ledgerName;
          break;
        }
      }
    }
  }
  
  // Mailing name - BILL TO ONLY
  const billToMailingName = gTagVal(block, 'BILLTOMAILINGNAME');
  if (billToMailingName) billTo.mailingName = billToMailingName;
  
  // Address - BILL TO ONLY
  billTo.address = extractBillToAddressOnly(block);
  
  // City - BILL TO ONLY
  const billToCity = gTagVal(block, 'BILLTOCITY');
  if (billToCity) billTo.city = billToCity;
  
  // State - BILL TO ONLY
  const billToState = gTagVal(block, 'BILLTOSTATE');
  if (billToState) billTo.state = billToState;
  
  // Country - BILL TO ONLY
  const billToCountry = gTagVal(block, 'BILLTOCOUNTRY');
  if (billToCountry) billTo.country = billToCountry;
  
  // Pincode - BILL TO ONLY
  // NOTE: BILLTOPINCODE in Tally vouchers can hold sequential internal counters
  // instead of the actual party pincode (Tally bug/misuse). We skip it entirely
  // and extract the pincode from the address text instead (6-digit number in address).
  const billToAddrForPin = billTo.address || '';
  const billToPincodeFromAddr = (billToAddrForPin.match(/\b([1-9]\d{5})\b/) || [])[1] || '';
  if (billToPincodeFromAddr) billTo.pincode = billToPincodeFromAddr;
  
  // GSTIN - BILL TO ONLY
  const billToGstin = gTagVal(block, 'BILLTOGSTIN');
  if (billToGstin) billTo.gstin = billToGstin;
  
  // GST Reg Type - BILL TO ONLY
  const billToGstRegType = gTagVal(block, 'BILLTOGSTREGISTRATIONTYPE');
  if (billToGstRegType) billTo.gstRegType = billToGstRegType;
  
  return billTo;
}

// ------------------------------
// SEPARATE MAP SHIP TO FUNCTION
// ------------------------------
// No bill to logic, no fallbacks to bill to, completely independent
function mapShipToFromRaw(block) {
  const shipTo = {
    name: '',
    mailingName: '',
    address: '',
    city: '',
    state: '',
    country: '',
    pincode: '',
    gstin: ''
  };
  
  // Name fields - SHIP TO ONLY
  const shipToName = gTagVal(block, 'SHIPTONAME');
  if (shipToName) shipTo.name = shipToName;
  
  const basicShipTo = gTagVal(block, 'BASICSHIPTO');
  if (!shipTo.name && basicShipTo) shipTo.name = basicShipTo;
  
  const consigneeName = gTagVal(block, 'CONSIGNEENAME');
  if (!shipTo.name && consigneeName) shipTo.name = consigneeName;
  
  const deliveryName = gTagVal(block, 'DELIVERYNAME');
  if (!shipTo.name && deliveryName) shipTo.name = deliveryName;
  
  const partyShippingName = gTagVal(block, 'PARTYSHIPPINGNAME');
  if (!shipTo.name && partyShippingName) shipTo.name = partyShippingName;
  
  // Mailing name - SHIP TO ONLY
  const shipToMailingName = gTagVal(block, 'SHIPTOMAILINGNAME');
  if (shipToMailingName) shipTo.mailingName = shipToMailingName;
  
  const consigneeMailingName = gTagVal(block, 'CONSIGNEEMAILINGNAME');
  if (!shipTo.mailingName && consigneeMailingName) shipTo.mailingName = consigneeMailingName;
  
  // Address - SHIP TO ONLY
  shipTo.address = extractShipToAddressOnly(block);
  
  // City - SHIP TO ONLY
  const shipToCity = gTagVal(block, 'SHIPTOCITY');
  if (shipToCity) shipTo.city = shipToCity;
  
  const consigneeCity = gTagVal(block, 'CONSIGNEECITY');
  if (!shipTo.city && consigneeCity) shipTo.city = consigneeCity;
  
  // State - SHIP TO ONLY
  const shipToState = gTagVal(block, 'SHIPTOSTATE');
  if (shipToState) shipTo.state = shipToState;
  
  const consigneeState = gTagVal(block, 'CONSIGNEESTATE');
  if (!shipTo.state && consigneeState) shipTo.state = consigneeState;
  
  // Country - SHIP TO ONLY
  const shipToCountry = gTagVal(block, 'SHIPTOCOUNTRY');
  if (shipToCountry) shipTo.country = shipToCountry;
  
  const consigneeCountry = gTagVal(block, 'CONSIGNEECOUNTRY');
  if (!shipTo.country && consigneeCountry) shipTo.country = consigneeCountry;
  
  // Pincode - SHIP TO ONLY
  const shipToPincode = gTagVal(block, 'SHIPTOPINCODE');
  if (shipToPincode) shipTo.pincode = shipToPincode;
  
  const consigneePincode = gTagVal(block, 'CONSIGNEEPINCODE');
  if (!shipTo.pincode && consigneePincode) shipTo.pincode = consigneePincode;
  
  // GSTIN - SHIP TO ONLY
  const shipToGstin = gTagVal(block, 'SHIPTOGSTIN');
  if (shipToGstin) shipTo.gstin = shipToGstin;
  
  const consigneeGstin = gTagVal(block, 'CONSIGNEEGSTIN');
  if (!shipTo.gstin && consigneeGstin) shipTo.gstin = consigneeGstin;
  
  return shipTo;
}

// Wrapper function that uses the completely separate mappers
function extractBillShipFromRaw(block) {
  const billTo = mapBillToFromRaw(block);
  const shipTo = mapShipToFromRaw(block);
  return { billTo, shipTo };
}

// ── Regex-based raw XML inventory/ledger entry extraction (mirrors tallySyncStream approach) ──
// Returns a Map keyed by voucherNumber (or GUID) → { inventoryEntries, ledgerEntries, billTo, shipTo }
function extractEntriesFromRawXml(xml) {
  const result = new Map(); // key: guid → { inventoryEntries, ledgerEntries, billTo, shipTo }

  // Split XML into per-voucher blocks.
  // Collection XML structure: <VOUCHER REMOTEID="..." VCHTYPE="..."> (always has attributes)
  // The CMPINFO section has <VOUCHER>0</VOUCHER> reference counts — skip those by
  // only matching <VOUCHER followed by a space (i.e. real vouchers with attributes).
  // Also handle nesting depth in case Tally emits sub-voucher elements.
  const OPEN_TAG  = '<VOUCHER ';   // 9 chars — only real vouchers (have attributes)
  const CLOSE_TAG = '</VOUCHER>'; // 10 chars
  const blocks = [];
  let searchFrom = 0;
  while (true) {
    // Find the next top-level <VOUCHER ...> or <VOUCHER>
    const start = xml.indexOf(OPEN_TAG, searchFrom);
    if (start === -1) break;
    // Verify it is really an opening tag (followed by > or whitespace)
    const afterOpen = xml[start + OPEN_TAG.length - 1]; // char after '<VOUCHER'
    // OPEN_TAG is '<VOUCHER ' so start already points to a real voucher
    // Walk forward tracking nesting depth
    let depth = 0;
    let i = start;
    let blockEnd = -1;
    while (i < xml.length) {
      const lt = xml.indexOf('<', i);
      if (lt === -1) break;
      // Opening <VOUCHER tag (any kind — with or without attributes)
      if (xml.startsWith('<VOUCHER', lt)) {
        const ch = xml[lt + 8];
        if (ch === '>' || (ch && /\s/.test(ch))) {
          depth++;
          i = lt + 8;
          continue;
        }
      }
      // Closing </VOUCHER> tag
      if (xml.startsWith(CLOSE_TAG, lt)) {
        depth--;
        if (depth === 0) {
          blockEnd = lt + CLOSE_TAG.length;
          break;
        }
        i = lt + CLOSE_TAG.length;
        continue;
      }
      i = lt + 1;
    }
    if (blockEnd !== -1) {
      blocks.push(xml.slice(start, blockEnd));
      searchFrom = blockEnd;
    } else {
      // Malformed — no matching close tag found; skip
      searchFrom = start + OPEN_TAG.length;
    }
  }
  LOG(`[extractEntriesFromRawXml] Extracted ${blocks.length} voucher blocks (nesting-aware)`);

  // Log first 3 voucher blocks for inspection to analyze Bill To/Ship To structure
  if (blocks.length > 0) {
    LOG(`[extractEntriesFromRawXml] First ${Math.min(3, blocks.length)} voucher blocks for inspection:`);
    blocks.slice(0, 3).forEach((block, index) => {
      LOG(`[Voucher Block ${index + 1}]: ${JSON.stringify(block)}`);
    });
  }

  for (const block of blocks) {
    const guid = gTagVal(block, 'GUID');
    const vNo  = gTagVal(block, 'VOUCHERNUMBER');
    const key  = guid || vNo;
    if (!key) continue;

    // ── Ledger entries ──
    const le = [];
    for (const lex of block.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi)) {
      const lb = lex[1];
      const ln = gTagVal(lb, 'LEDGERNAME');
      if (ln) le.push({
        ledgerName: ln,
        amount: parseFloat(gTagVal(lb, 'AMOUNT').replace(/[^\d.-]/g, '')) || 0,
        isDeemed: gTagVal(lb, 'ISDEEMEDPOSITIVE') === 'Yes',
      });
    }
    // Fallback: LEDGERENTRIES.LIST
    if (le.length === 0) {
      for (const lex of block.matchAll(/<LEDGERENTRIES\.LIST>([\s\S]*?)<\/LEDGERENTRIES\.LIST>/gi)) {
        const lb = lex[1];
        const ln = gTagVal(lb, 'LEDGERNAME');
        if (ln) le.push({
          ledgerName: ln,
          amount: parseFloat(gTagVal(lb, 'AMOUNT').replace(/[^\d.-]/g, '')) || 0,
          isDeemed: gTagVal(lb, 'ISDEEMEDPOSITIVE') === 'Yes',
        });
      }
    }

    // ── Inventory entries ──
    const ie = [];
    const invPattern = /<ALLINVENTORYENTRIES\.LIST>([\s\S]*?)<\/ALLINVENTORYENTRIES\.LIST>|<INVENTORYENTRIES\.LIST>([\s\S]*?)<\/INVENTORYENTRIES\.LIST>/gi;
    for (const inv of block.matchAll(invPattern)) {
      const ib = inv[1] || inv[2];
      const sn = gTagVal(ib, 'STOCKITEMNAME');
      if (!sn) continue;
      const rawQty  = gTagVal(ib, 'BILLEDQTY') || gTagVal(ib, 'ACTUALQTY') || '0';
      const rawRate = gTagVal(ib, 'RATE') || '0';
      const qty   = parseFloat(rawQty.replace(/[^\d.-]/g, ''))  || 0;
      const rate  = parseFloat(rawRate.replace(/[^\d.-]/g, '')) || 0;
      const amt   = Math.abs(parseFloat(gTagVal(ib, 'AMOUNT').replace(/[^\d.-]/g, '')) || 0);

      // Per-item ACCOUNTINGALLOCATIONS (tax breakdown)
      const itemTaxEntries = [];
      for (const aa of ib.matchAll(/<ACCOUNTINGALLOCATIONS\.LIST>([\s\S]*?)<\/ACCOUNTINGALLOCATIONS\.LIST>/gi)) {
        const ab = aa[1];
        const an = gTagVal(ab, 'LEDGERNAME');
        const aa2 = Math.abs(parseFloat(gTagVal(ab, 'AMOUNT').replace(/[^\d.-]/g, '')) || 0);
        if (an) itemTaxEntries.push({ ledgerName: an, amount: aa2 });
      }

      ie.push({ stockItemName: sn, qty, rate, amount: amt, taxEntries: itemTaxEntries });
    }

    const { billTo, shipTo } = extractBillShipFromRaw(block);
    result.set(key, { inventoryEntries: ie, ledgerEntries: le, billTo, shipTo });
  }

  LOG(`[extractEntriesFromRawXml] Extracted entries for ${result.size} voucher blocks`);
  return result;
}

function parseVouchers(xml, voucherTypes) {
  const vouchers = [];
  const mismatched = [];
  const failed = [];

  // Pre-extract all entries via raw XML regex (guaranteed to find dot-named LIST tags)
  const rawEntryMap = extractEntriesFromRawXml(xml);
  LOG(`[parseVouchers] Raw entry map has ${rawEntryMap.size} vouchers with inventory/ledger data`);

  try {
    const parsed = xmlParser.parse(xml);
    let voucherList = [];
    
    // Find vouchers in all known Tally response structures.
    // Day Book "Export Data" returns:
    //   ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE = [{VOUCHER: {...}}, ...]
    //   — TALLYMESSAGE is an ARRAY, each element has one VOUCHER object.
    // Collection format returns:
    //   ENVELOPE.BODY.DATA.COLLECTION.VOUCHER = [...]  or  DATA.TALLYMESSAGE.VOUCHER = [...]

    const tryPath = (...keys) => {
      let node = parsed.ENVELOPE?.BODY;
      for (const k of keys) { if (!node) break; node = node[k]; }
      return node;
    };

    // ── Path 1: Day Book — TALLYMESSAGE is array of {VOUCHER} ──
    const tallyMsgArr = tryPath('IMPORTDATA', 'REQUESTDATA', 'TALLYMESSAGE');
    if (Array.isArray(tallyMsgArr) && tallyMsgArr.length > 0 && tallyMsgArr[0]?.VOUCHER) {
      voucherList = tallyMsgArr.map(m => m.VOUCHER).filter(Boolean);
      LOG(`[parseVouchers] Using path: IMPORTDATA.REQUESTDATA.TALLYMESSAGE[].VOUCHER → ${voucherList.length} vouchers`);
    }
    // ── Path 2: Day Book — TALLYMESSAGE is object with VOUCHER array ──
    else if (tryPath('IMPORTDATA', 'REQUESTDATA', 'TALLYMESSAGE', 'VOUCHER')) {
      voucherList = tryPath('IMPORTDATA', 'REQUESTDATA', 'TALLYMESSAGE', 'VOUCHER');
      voucherList = Array.isArray(voucherList) ? voucherList : [voucherList];
      LOG(`[parseVouchers] Using path: IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER → ${voucherList.length} vouchers`);
    }
    // ── Path 3: Collection VOUCHER array ──
    else if (tryPath('DATA', 'COLLECTION', 'VOUCHER')) {
      voucherList = tryPath('DATA', 'COLLECTION', 'VOUCHER');
      voucherList = Array.isArray(voucherList) ? voucherList : [voucherList];
      LOG(`[parseVouchers] Using path: DATA.COLLECTION.VOUCHER → ${voucherList.length} vouchers`);
    }
    // ── Path 4: Older TALLYMESSAGE.VOUCHER ──
    else if (tryPath('DATA', 'TALLYMESSAGE', 'VOUCHER')) {
      voucherList = tryPath('DATA', 'TALLYMESSAGE', 'VOUCHER');
      voucherList = Array.isArray(voucherList) ? voucherList : [voucherList];
      LOG(`[parseVouchers] Using path: DATA.TALLYMESSAGE.VOUCHER → ${voucherList.length} vouchers`);
    }
    // ── Path 5: Root TALLYMESSAGE array ──
    else {
      const rootTm = parsed.ENVELOPE?.TALLYMESSAGE || parsed.TALLYMESSAGE;
      if (Array.isArray(rootTm) && rootTm[0]?.VOUCHER) {
        voucherList = rootTm.map(m => m.VOUCHER).filter(Boolean);
        LOG(`[parseVouchers] Using path: root.TALLYMESSAGE[].VOUCHER → ${voucherList.length} vouchers`);
      } else if (rootTm?.VOUCHER) {
        voucherList = Array.isArray(rootTm.VOUCHER) ? rootTm.VOUCHER : [rootTm.VOUCHER];
        LOG(`[parseVouchers] Using path: root.TALLYMESSAGE.VOUCHER → ${voucherList.length} vouchers`);
      } else if (parsed.VOUCHER) {
        voucherList = Array.isArray(parsed.VOUCHER) ? parsed.VOUCHER : [parsed.VOUCHER];
        LOG(`[parseVouchers] Using path: root.VOUCHER → ${voucherList.length} vouchers`);
      } else {
        LOG(`[parseVouchers] ❌ Could not find VOUCHER in any known path`);
        LOG(`[parseVouchers] BODY keys: ${Object.keys(parsed.ENVELOPE?.BODY || {}).join(', ')}`);
      }
    }

    // Ensure we always work with a flat array of voucher objects
    if (!voucherList) {
      voucherList = [];
    } else if (!Array.isArray(voucherList)) {
      voucherList = [voucherList];
    }

    LOG(`[parseVouchers] Total vouchers fetched from Tally: ${voucherList.length}`);
    if (voucherList.length > 0) {
      LOG(`[parseVouchers] First parsed record: ${JSON.stringify(voucherList[0], null, 2)}`);
    }

    // Log ALL voucher type names coming from Tally — critical for diagnosing custom type names
    const foundVoucherTypes = new Set();
    voucherList.forEach(v => {
      const vt = getSafeValue(v, 'VOUCHERTYPENAME') || getSafeValue(v, 'VCHTYPE') || '';
      if (vt) foundVoucherTypes.add(vt);
    });
    LOG(`[parseVouchers] All voucher types found in XML: ${Array.from(foundVoucherTypes).join(' | ') || '(none)'}`);
    if (voucherTypes && voucherTypes.length > 0) {
      LOG(`[parseVouchers] Filtering for types: ${voucherTypes.join(' | ')}`);
    }

    for (const voucher of voucherList) {
      // Try VOUCHERTYPENAME first, then VCHTYPE element, then @_VCHTYPE attribute (Collection format)
      const vt = getSafeValue(voucher, 'VOUCHERTYPENAME') || getSafeValue(voucher, 'VCHTYPE') || getSafeValue(voucher, '@_VCHTYPE') || '';
      
      // Filter by voucher types if specified (case-insensitive, also partial match for custom names)
      if (voucherTypes && voucherTypes.length > 0) {
        const vtLower = vt.toLowerCase();
        const typeMatches = voucherTypes.some(type => {
          const tLower = type.toLowerCase();
          return vtLower === tLower || vtLower.includes(tLower) || tLower.includes(vtLower);
        });
        if (!typeMatches) {
          mismatched.push({ type: vt, voucherNumber: getSafeValue(voucher, 'VOUCHERNUMBER') });
          continue;
        }
      }

      const guid      = getSafeValue(voucher, 'GUID');
      const alterId   = getSafeValue(voucher, 'ALTERID');
      const voucherNumber = getSafeValue(voucher, 'VOUCHERNUMBER');
      // PARTYLEDGERNAME is the debtors ledger name (party). Fall back to PARTYNAME.
      const partyName = getSafeValue(voucher, 'PARTYLEDGERNAME') || getSafeValue(voucher, 'PARTYNAME');
      const rawDate   = getSafeValue(voucher, 'DATE');
      const narration = getSafeValue(voucher, 'NARRATION');
      const partyGstin = getSafeValue(voucher, 'PARTYGSTIN');
      const placeOfSupply = getSafeValue(voucher, 'PLACEOFSUPPLY');

      // E-invoice fields
      // Validate IRN: a genuine GST e-invoice IRN is exactly 64 hex characters.
      // Tally sometimes returns the voucher GUID (a UUID-like value with hyphens/slashes)
      // in the IRN field when no real IRN exists — discard those.
      const rawIrn = getSafeValue(voucher, 'IRN') || getSafeValue(voucher, 'EINVOICEIRN');
      const irn = (rawIrn && /^[0-9a-fA-F]{64}$/.test(rawIrn.trim())) ? rawIrn.trim() : '';
      const ackNo = getSafeValue(voucher, 'ACKNO') || getSafeValue(voucher, 'EINVOICEACKNO');
      const rawAckDate = getSafeValue(voucher, 'ACKDATE') || getSafeValue(voucher, 'EINVOICEACKDATE');
      let ackDate = null;
      if (rawAckDate && rawAckDate.length === 8 && /^\d{8}$/.test(rawAckDate)) {
        ackDate = new Date(`${rawAckDate.slice(0,4)}-${rawAckDate.slice(4,6)}-${rawAckDate.slice(6,8)}`);
        if (isNaN(ackDate.getTime())) ackDate = null;
      }

      // Delivery & reference fields
      const deliveryNote = getSafeValue(voucher, 'DELIVERYNOTE') || getSafeValue(voucher, 'DELIVERYNOTE');
      const referenceNo = getSafeValue(voucher, 'REFERENCENO') || getSafeValue(voucher, 'REFERENCE');
      const rawReferenceDate = getSafeValue(voucher, 'REFERENCEDATE');
      let referenceDate = null;
      if (rawReferenceDate && rawReferenceDate.length === 8 && /^\d{8}$/.test(rawReferenceDate)) {
        referenceDate = new Date(`${rawReferenceDate.slice(0,4)}-${rawReferenceDate.slice(4,6)}-${rawReferenceDate.slice(6,8)}`);
        if (isNaN(referenceDate.getTime())) referenceDate = null;
      }
      const buyersOrderNo = getSafeValue(voucher, 'BUYERSORDERNO') || getSafeValue(voucher, 'ORDERNO') || getSafeValue(voucher, 'BUYERORDERNO') || getSafeValue(voucher, 'PURCHASEORDERNO');
      const rawBuyersOrderDate = getSafeValue(voucher, 'ORDERDATE') || getSafeValue(voucher, 'BUYERORDERDATE') || getSafeValue(voucher, 'PURCHASEORDERDATE');
      let buyersOrderDate = null;
      if (rawBuyersOrderDate && rawBuyersOrderDate.length === 8 && /^\d{8}$/.test(rawBuyersOrderDate)) {
        buyersOrderDate = new Date(`${rawBuyersOrderDate.slice(0,4)}-${rawBuyersOrderDate.slice(4,6)}-${rawBuyersOrderDate.slice(6,8)}`);
        if (isNaN(buyersOrderDate.getTime())) buyersOrderDate = null;
      }
      const dispatchDocNo = getSafeValue(voucher, 'DISPATCHDOCNO') || getSafeValue(voucher, 'DISPATCHDOCUMENTNO') || getSafeValue(voucher, 'LRNO');
      const dispatchedThrough = getSafeValue(voucher, 'DISPATCHEDTHROUGH') || getSafeValue(voucher, 'TRANSPORT') || getSafeValue(voucher, 'TRANSPORTERNAME');
      const destination = getSafeValue(voucher, 'DESTINATION');
      const billOfLadingNo = getSafeValue(voucher, 'BILLOFLADINGNO') || getSafeValue(voucher, 'LRNO');
      const motorVehicleNo = getSafeValue(voucher, 'VEHICLENO') || getSafeValue(voucher, 'MOTORVEHICLENO');
      const termsOfDelivery = getSafeValue(voucher, 'TERMSOFDELIVERY') || getSafeValue(voucher, 'DELIVERYTERMS');

      // Log voucher to see all available fields
      LOG('Parsing voucher with fields:', Object.keys(voucher));

      // ── Get regex-extracted entries FIRST (primary — bypasses fast-xml-parser dot-tag issues) ──
      const rawData = rawEntryMap.get(guid) || rawEntryMap.get(voucherNumber) || null;
      
      // Bill To info:
      // Priority order for Bill To name:
      //   1. Explicit BILLTONAME tag (most reliable)
      //   2. BILLTOLEDGERNAME tag
      //   3. partyName (PARTYLEDGERNAME) — Tally's debtor ledger = always the buyer
      //
      // We deliberately skip BASICBUYERNAME / BUYERNAME — Tally puts the CONSIGNEE
      // name in those fields for inter-state invoices, which caused wrong bill-to.
      const parsedBillTo = mapBillToFromParsed(voucher);
      const parsedShipTo = mapShipToFromParsed(voucher);

      const rawBillToName = rawData?.billTo?.name || parsedBillTo.name;
      const rawShipToName = rawData?.shipTo?.name || parsedShipTo.name;
      // Use partyName as the bill-to name fallback — PARTYLEDGERNAME is always the buyer.
      const billToName = rawBillToName || partyName;
      const billToMailingName = rawData?.billTo?.mailingName || parsedBillTo.mailingName;
      // Strip literal TDL formula strings that Tally sometimes emits unexpanded
      const cleanAddr = (addr) => {
        if (!addr) return '';
        // Remove any TDL formula references like <BASICBUYERADDRESS>, <$SomeFormula> etc.
        const cleaned = addr.replace(/<[^>]+>/g, '').trim();
        // Also reject dot-only placeholders like ".", "...", "..." from unexpanded TDL
        if (/^\.+$/.test(cleaned)) return '';
        return cleaned;
      };
      const billToAddress = cleanAddr(rawData?.billTo?.address || parsedBillTo.address);
      const billToCity = rawData?.billTo?.city || parsedBillTo.city;
      const billToState = rawData?.billTo?.state || parsedBillTo.state;
      const billToCountry = rawData?.billTo?.country || parsedBillTo.country;
      // Pincode: BILLTOPINCODE tag is unreliable (Tally often stores a sequential counter there).
      // Leave it empty so backfillBillToFromLedger can populate it from the party ledger master.
      const billToPincode = '';
      const billToGST = rawData?.billTo?.gstin || parsedBillTo.gstin;
      const billToGstRegType = rawData?.billTo?.gstRegType || parsedBillTo.gstRegType;
      
      // Ship To info: raw-extracted first, else parsed - NO BILL TO FALLBACK
      const shipToName = rawData?.shipTo?.name || parsedShipTo.name;
      const shipToMailingName = rawData?.shipTo?.mailingName || parsedShipTo.mailingName;
      const shipToAddress = cleanAddr(rawData?.shipTo?.address || parsedShipTo.address);
      const shipToCity = rawData?.shipTo?.city || parsedShipTo.city;
      const shipToState = rawData?.shipTo?.state || parsedShipTo.state;
      const shipToCountry = rawData?.shipTo?.country || parsedShipTo.country;
      const shipToPincode = rawData?.shipTo?.pincode || parsedShipTo.pincode;
      const shipToGST = rawData?.shipTo?.gstin || parsedShipTo.gstin;
      
      // DATE format: YYYYMMDD (e.g. 20260401). Null-safe — skip if date invalid
      let vDate;
      if (rawDate && rawDate.length === 8 && /^\d{8}$/.test(rawDate)) {
        vDate = new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`);
        if (isNaN(vDate.getTime())) vDate = null;
      } else {
        vDate = null; // will be skipped or use today as last resort
      }
      if (!vDate) {
        LOG(`[parseVouchers] Skipping voucher ${voucherNumber} — no valid date (rawDate="${rawDate}")`);
        continue;
      }

      // ── Qty/Rate parser — handles "36 Nos", "910.00 /Nos", plain numbers ──
      const parseTallyQty = (raw) => {
        if (raw === null || raw === undefined || raw === '') return 0;
        if (typeof raw === 'number') return isNaN(raw) ? 0 : Math.abs(raw);
        // Strip unit suffixes like " Nos", " /Nos", " KG" etc.
        const s = String(raw).replace(/[a-zA-Z\/\s]+$/, '').replace(/[^\d.-]/g, '').trim();
        const n = parseFloat(s);
        return isNaN(n) ? 0 : Math.abs(n);
      };

      // ── Parse ALLLEDGERENTRIES.LIST / LEDGERENTRIES.LIST (party + tax lines) ─────────────
      // Prefer regex-extracted data; fall back to XML-parsed data
      let ledgerEntries = rawData?.ledgerEntries || [];
      if (ledgerEntries.length === 0) {
        const rawLedgerEntries =
          voucher['ALLLEDGERENTRIES.LIST'] ||   // Collection format
          voucher['LEDGERENTRIES.LIST']    ||   // Day Book format (actual Tally Prime response)
          voucher['ACCOUNTINGALLOCATIONS.LIST'] || [];
        const ledgerEntriesArray = Array.isArray(rawLedgerEntries)
          ? rawLedgerEntries
          : (rawLedgerEntries ? [rawLedgerEntries] : []);
        for (const le of ledgerEntriesArray) {
          const lName = getSafeValue(le, 'LEDGERNAME');
          const lAmt  = getSafeNumber(le, 'AMOUNT');
          const isDmd = getSafeValue(le, 'ISDEEMEDPOSITIVE', 'No').trim() === 'Yes';
          if (lName) ledgerEntries.push({ ledgerName: lName, amount: lAmt, isDeemed: isDmd });
        }
      }

      // ── Parse ALLINVENTORYENTRIES.LIST (item lines) ───────────────────────
      // Prefer regex-extracted data; fall back to XML-parsed data
      let inventoryEntries = rawData?.inventoryEntries || [];
      if (inventoryEntries.length === 0) {
        const rawInvEntries =
          voucher['ALLINVENTORYENTRIES.LIST'] ||
          voucher['INVENTORYENTRIES.LIST']    || [];
        const inventoryEntriesArray = Array.isArray(rawInvEntries)
          ? rawInvEntries
          : (rawInvEntries ? [rawInvEntries] : []);

        // Log structure of first voucher's first inventory entry to help diagnose
        if (inventoryEntriesArray.length > 0 && vouchers.length === 0) {
          LOG(`[parseVouchers] First inventory entry raw (XML-parsed): ${JSON.stringify(inventoryEntriesArray[0]).slice(0, 800)}`);
        }

        for (const ie of inventoryEntriesArray) {
          const stockItemName = getSafeValue(ie, 'STOCKITEMNAME');
          if (!stockItemName) continue;
          const rawQty  = getSafeValue(ie, 'BILLEDQTY') || getSafeValue(ie, 'ACTUALQTY') || '0';
          const qty     = parseTallyQty(rawQty);
          const rawRate = getSafeValue(ie, 'RATE') || '0';
          const rate    = parseTallyQty(rawRate);
          const amt     = Math.abs(getSafeNumber(ie, 'AMOUNT'));
          const itemTaxEntries = [];
          const rawAccAlloc = ie['ACCOUNTINGALLOCATIONS.LIST'] || [];
          const accAllocArr = Array.isArray(rawAccAlloc) ? rawAccAlloc : (rawAccAlloc ? [rawAccAlloc] : []);
          for (const aa of accAllocArr) {
            const aaName = getSafeValue(aa, 'LEDGERNAME');
            const aaAmt  = Math.abs(getSafeNumber(aa, 'AMOUNT'));
            if (aaName) itemTaxEntries.push({ ledgerName: aaName, amount: aaAmt });
          }
          inventoryEntries.push({ stockItemName, qty, rate, amount: amt, taxEntries: itemTaxEntries });
        }
      }

      if (inventoryEntries.length > 0 && vouchers.length === 0) {
        LOG(`[parseVouchers] First voucher inventory entries (${inventoryEntries.length}): ${JSON.stringify(inventoryEntries[0])}`);
      }

      // ── Parse BILLALLOCATIONS.LIST ────────────────────────────────────────
      const billAllocations = [];
      const rawBillAlloc = voucher['BILLALLOCATIONS.LIST'] || [];
      const billAllocArr = Array.isArray(rawBillAlloc) ? rawBillAlloc : [rawBillAlloc];
      for (const ba of billAllocArr) {
        const billName = getSafeValue(ba, 'BILLNAME');
        const billAmt  = getSafeNumber(ba, 'AMOUNT');
        if (billName) billAllocations.push({ billName, amount: billAmt });
      }

      // ── Detect tax lines from ledger entries ──────────────────────────────
      const taxLines = ledgerEntries.filter(le => {
        const n = le.ledgerName.toLowerCase();
        return n.includes('cgst') || n.includes('sgst') || n.includes('igst') ||
               n.includes('cess') || n.includes('utgst');
      });

      // ── Amount calculation ────────────────────────────────────────────────
      // Priority 1: inventory items exist → subtotal + tax ledger lines + freight/transportation + round-off
      // Priority 2: ledger entries only (payment/receipt/journal)
      // Priority 3: top-level AMOUNT field
      let subtotal = 0;
      let taxTotal = 0;
      let amount   = 0;

      // Identify freight/transportation/delivery/cartage/shipping ledger entries
      const isFreightEntry = (le) => {
        const name = le.ledgerName.toLowerCase();
        return name.includes('freight') || 
               name.includes('transport') || 
               name.includes('delivery') || 
               name.includes('cartage') || 
               name.includes('shipping');
      };

      if (inventoryEntries.length > 0) {
        subtotal = inventoryEntries.reduce((s, ie) => s + ie.amount, 0);
        taxTotal = taxLines.reduce((s, le) => s + Math.abs(le.amount), 0);
        // Catch round-off ledger entry
        const roundOff = ledgerEntries
          .filter(le => le.ledgerName.toLowerCase().includes('round'))
          .reduce((s, le) => s + Math.abs(le.amount), 0);
        // Catch freight/transportation charges
        const freightTotal = ledgerEntries
          .filter(le => isFreightEntry(le))
          .reduce((s, le) => s + Math.abs(le.amount), 0);
        amount = subtotal + taxTotal + roundOff + freightTotal;
      } else if (ledgerEntries.length > 0) {
        amount = Math.max(...ledgerEntries.map(le => Math.abs(le.amount)));
        if (!isFinite(amount)) amount = 0;
        subtotal = amount;
      } else {
        amount   = Math.abs(getSafeNumber(voucher, 'AMOUNT'));
        subtotal = amount;
      }

      // Final fallback to top-level AMOUNT
      if (amount === 0) {
        amount = Math.abs(getSafeNumber(voucher, 'AMOUNT'));
      }

      vouchers.push({
        guid,
        alterId,
        voucherNumber,
        voucherType: vt,       // raw Tally type — normalised later
        partyName,
        partyGstin,
        placeOfSupply,
        irn,
        ackNo,
        ackDate,
        deliveryNote,
        referenceNo,
        referenceDate,
        buyersOrderNo,
        buyersOrderDate,
        dispatchDocNo,
        dispatchedThrough,
        destination,
        billOfLadingNo,
        motorVehicleNo,
        termsOfDelivery,
        billToName,
        billToMailingName,
        billToAddress,
        billToCity,
        billToState,
        billToCountry,
        billToGST,
        billToGstRegType,
        billToPincode,
        shipToName,
        shipToMailingName,
        shipToAddress,
        shipToCity,
        shipToState,
        shipToCountry,
        shipToGST,
        amount,
        subtotal,
        taxTotal,
        taxLines,            // [{ledgerName, amount}] — CGST/SGST/IGST lines
        narration,
        vDate,
        ledgerEntries,
        inventoryEntries,      // [{stockItemName, qty, rate, amount, taxEntries}]
        billAllocations,
      });
    }
  } catch (e) {
    ERR('Error parsing vouchers', e);
  }

  // Group mismatched by type so the log is readable
  if (mismatched.length > 0) {
    const byType = {};
    mismatched.forEach(m => { byType[m.type || '(blank)'] = (byType[m.type || '(blank)'] || 0) + 1; });
    LOG(`[parseVouchers] Skipped ${mismatched.length} mismatched vouchers by type: ${JSON.stringify(byType)}`);
    LOG(`[parseVouchers] ⚠️  If Sales Register is empty, check that the Tally voucher type name matches one of: ${(voucherTypes||[]).join(', ')}`);
  }
  LOG(`[parseVouchers] Valid records: ${vouchers.length}, Mismatched: ${mismatched.length}, Failed: ${failed.length}`);
  return { vouchers, mismatchedCount: mismatched.length, failedCount: failed.length, foundTypes: [...new Set(vouchers.map(v => v.voucherType))] };
}

// Normalize a raw Tally voucherTypeName to one of the TallyVoucher model enum values.
// Tally companies can have custom type names like "GST Credit Note" or "Tax Invoice".
// We do a case-insensitive keyword match to map them to canonical values.
const VOUCHER_TYPE_ENUM = ['Payment', 'Receipt', 'Journal', 'Contra', 'Sales', 'Purchase', 'Debit Note', 'Credit Note'];
function normaliseVoucherType(raw) {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  // Exact match first (after normalisation)
  for (const t of VOUCHER_TYPE_ENUM) {
    if (lower === t.toLowerCase()) return t;
  }
  // Keyword / partial match
  if (lower.includes('credit note')) return 'Credit Note';
  if (lower.includes('debit note'))  return 'Debit Note';
  if (lower.includes('purchase'))    return 'Purchase';
  if (lower.includes('sales') || lower.includes('invoice') || lower.includes('tax invoice')) return 'Sales';
  if (lower.includes('payment'))     return 'Payment';
  if (lower.includes('receipt'))     return 'Receipt';
  if (lower.includes('journal'))     return 'Journal';
  if (lower.includes('contra'))      return 'Contra';
  return null; // cannot map — caller will skip
}

function vouchersToInvoiceOps(vouchers) {
  return vouchers.map(v => {
    if (!v.guid) {
      LOG('Skipping invoice voucher without GUID:', JSON.stringify(v).slice(0, 200));
      return null;
    }
    const invoiceNo = v.voucherNumber
      ? v.voucherNumber.trim()
      : `TALLY-${v.guid.replace(/[^A-Z0-9]/gi, '').slice(0, 30)}`;

    const safePartyName = (v.partyName || 'Unknown Party').trim();

    // Detect CGST/SGST/IGST from taxLines (preferred) or ledgerEntries
    const taxSource = v.taxLines?.length ? v.taxLines : (v.ledgerEntries || []).filter(le => {
      const n = le.ledgerName.toLowerCase();
      return n.includes('cgst') || n.includes('sgst') || n.includes('igst') || n.includes('cess');
    });

    const cgstAmt = taxSource
      .filter(t => t.ledgerName.toLowerCase().includes('cgst'))
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const sgstAmt = taxSource
      .filter(t => t.ledgerName.toLowerCase().includes('sgst'))
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const igstAmt = taxSource
      .filter(t => t.ledgerName.toLowerCase().includes('igst'))
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    // Map inventory entries → invoice items[]
    const items = (v.inventoryEntries || []).map((ie, index) => {
      const basic    = ie.amount || (ie.qty * ie.rate);
      // Item-level tax from ACCOUNTINGALLOCATIONS.LIST inside inventory entry
      const itemCgst = (ie.taxEntries || [])
        .filter(t => t.ledgerName.toLowerCase().includes('cgst'))
        .reduce((s, t) => s + t.amount, 0);
      const itemSgst = (ie.taxEntries || [])
        .filter(t => t.ledgerName.toLowerCase().includes('sgst'))
        .reduce((s, t) => s + t.amount, 0);
      const itemIgst = (ie.taxEntries || [])
        .filter(t => t.ledgerName.toLowerCase().includes('igst'))
        .reduce((s, t) => s + t.amount, 0);
      const taxAmount = itemCgst + itemSgst + itemIgst;
      // Use extractGstRate instead of mathematical calculation!
      const taxRate = extractGstRate(v, v.inventoryEntries && v.inventoryEntries[index] ? v.inventoryEntries[index] : null, v.taxLines || []);

      return {
        description: ie.stockItemName,
        hsn:         '',
        qty:         ie.qty   || 0,
        unit:        'Nos',
        rate:        ie.rate  || 0,
        discount:    0,
        taxRate,
        basic,
        amount:      basic,
        taxAmount,
        total:       basic + taxAmount,
        cgst:        itemCgst,
        sgst:        itemSgst,
        igst:        itemIgst,
      };
    });

    // If no item-level tax was found, distribute voucher-level tax proportionally
    const totalItemTax = items.reduce((s, it) => s + it.taxAmount, 0);
    if (totalItemTax === 0 && (cgstAmt || sgstAmt || igstAmt) && items.length > 0) {
      const voucherTax = cgstAmt + sgstAmt + igstAmt;
      const voucherGstRate = extractGstRate(v, null, v.taxLines || []);
      items.forEach((it) => {
        const share = items.length > 0 ? voucherTax / items.length : 0;
        it.cgst = cgstAmt / items.length;
        it.sgst = sgstAmt / items.length;
        it.igst = igstAmt / items.length;
        it.taxAmount = share;
        it.total     = it.basic + share;
        // Use only extracted GST rate, never calculate from amounts
        it.taxRate   = voucherGstRate;
      });
    }

    const subtotal   = v.subtotal || items.reduce((s, it) => s + it.basic, 0);
    const totalTax   = v.taxTotal || cgstAmt + sgstAmt + igstAmt;
    // Use the full amount from parseVouchers which already includes freight/round-off
    const grandTotal = v.amount   || subtotal + totalTax;

    return {
      updateOne: {
        filter: { tallyGuid: v.guid },
        update: {
          $set: {
            tallyGuid:            v.guid,
            tallyAlterId:         v.alterId,
            partyName:            safePartyName,
            partyGST:             v.partyGstin || '',
            billToName:           v.billToName || '',
            billToMailingName:    v.billToMailingName || '',
            billToAddress:        v.billToAddress || '',
            billToCity:           v.billToCity || '',
            billToState:          v.billToState || '',
            billToCountry:        v.billToCountry || '',
            billToGST:            v.billToGST || '',
            billToGstRegType:     v.billToGstRegType || '',
            billToPincode:        v.billToPincode || '',
            shipToName:           v.shipToName || '',
            shipToMailingName:    v.shipToMailingName || '',
            shipToAddress:        v.shipToAddress || '',
            shipToCity:           v.shipToCity || '',
            shipToState:          v.shipToState || '',
            shipToCountry:        v.shipToCountry || '',
            shipToGST:            v.shipToGST || '',
            grandTotal,
            subtotal,
            totalTax,
            narration:    v.narration,
            invoiceDate:  v.vDate,
            source:       'Tally',
            status:       'Sent',
            invoiceType:  items.length > 1 ? 'multi' : 'single',
            items,
            ledgerEntries:   v.ledgerEntries,
            billAllocations: v.billAllocations,
            tallyVoucherNumber: v.voucherNumber,
            buyersOrderNo:    v.buyersOrderNo || '',
          },
          $setOnInsert: { invoiceNo }
        },
        upsert: true
      }
    };
  }).filter(Boolean);
}

function vouchersToTallyVoucherOps(vouchers) {
  const skipped = [];
  const ops = vouchers.map(v => {
    if (!v.guid) {
      LOG('Skipping voucher without GUID:', JSON.stringify(v).slice(0, 200));
      return null;
    }

    // Normalise raw Tally type name → enum value.
    // Reject vouchers whose type cannot be mapped to avoid Mongoose validation errors.
    const canonicalType = normaliseVoucherType(v.voucherType);
    if (!canonicalType) {
      skipped.push({ guid: v.guid, rawType: v.voucherType });
      return null;
    }

    const safePartyName = (v.partyName || '').trim();

    // Always update core fields. Only overwrite inventoryEntries/ledgerEntries/amount
    // when the parsed data actually has content — this prevents a partial Day Book response
    // (e.g. a chunk that returns a voucher header but no sub-lists) from wiping good data
    // that was already saved from a previous full sync.
    const alwaysSet = {
      tallyGuid:       v.guid,
      tallyAlterId:    v.alterId,
      voucherNumber:   v.voucherNumber,
      voucherType:     canonicalType,
      partyName:       safePartyName,
      partyLedgerName: safePartyName,
      partyGstin:      v.partyGstin  || '',
      placeOfSupply:   v.placeOfSupply || '',
      irn:             v.irn || '',
      ackNo:           v.ackNo || '',
      ackDate:         v.ackDate || null,
      deliveryNote:    v.deliveryNote || '',
      referenceNo:     v.referenceNo || '',
      referenceDate:   v.referenceDate || null,
      buyersOrderNo:   v.buyersOrderNo || '',
      buyersOrderDate: v.buyersOrderDate || null,
      dispatchDocNo:   v.dispatchDocNo || '',
      dispatchedThrough: v.dispatchedThrough || '',
      destination:     v.destination || '',
      billOfLadingNo:  v.billOfLadingNo || '',
      motorVehicleNo:  v.motorVehicleNo || '',
      termsOfDelivery: v.termsOfDelivery || '',
      billToName:      v.billToName || '',
      billToMailingName: v.billToMailingName || '',
      billToAddress:   v.billToAddress || '',
      billToCity:      v.billToCity || '',
      billToState:     v.billToState || '',
      billToCountry:   v.billToCountry || '',
      billToGST:       v.billToGST || '',
      billToGstRegType: v.billToGstRegType || '',
      billToPincode:   v.billToPincode || '',
      shipToName:      v.shipToName || '',
      shipToMailingName: v.shipToMailingName || '',
      shipToAddress:   v.shipToAddress || '',
      shipToCity:      v.shipToCity || '',
      shipToState:     v.shipToState || '',
      shipToCountry:   v.shipToCountry || '',
      shipToGST:       v.shipToGST || '',
      narration:       v.narration,
      voucherDate:     v.vDate,
      source:          'Tally',
      syncedAt:        new Date(),
    };

    // Only overwrite amount/subtotal/taxTotal when they are non-zero in the parsed data
    if (v.amount > 0) {
      alwaysSet.amount   = v.amount;
      alwaysSet.subtotal = v.subtotal || 0;
      alwaysSet.taxTotal = v.taxTotal || 0;
    }
    // Only overwrite taxLines when we have actual tax entries
    if (v.taxLines && v.taxLines.length > 0) {
      alwaysSet.taxLines = v.taxLines;
    }
    // Only overwrite ledgerEntries when we have actual entries
    if (v.ledgerEntries && v.ledgerEntries.length > 0) {
      alwaysSet.ledgerEntries = v.ledgerEntries;
    }
    // Only overwrite inventoryEntries when we have actual items
    if (v.inventoryEntries && v.inventoryEntries.length > 0) {
      alwaysSet.inventoryEntries = v.inventoryEntries;
    }
    // Only overwrite billAllocations when we have actual allocations
    if (v.billAllocations && v.billAllocations.length > 0) {
      alwaysSet.billAllocations = v.billAllocations;
    }

    return {
      updateOne: {
        filter: { tallyGuid: v.guid },
        update: { $set: alwaysSet },
        upsert: true
      }
    };
  }).filter(Boolean);

  if (skipped.length > 0) {
    LOG(`[vouchersToTallyVoucherOps] Skipped ${skipped.length} vouchers with unmappable types: ${JSON.stringify(skipped.slice(0, 5))}`);
  }
  return ops;
}

// === DB WRITE HELPERS ===
async function writeItemsToDb(ops) {
  if (!ops.length) return 0;
  try {
    const r = await ItemMaster.bulkWrite(ops, { ordered: false });
    return (r.upsertedCount || 0) + (r.modifiedCount || 0);
  } catch (e) {
    ERR('ItemMaster bulkWrite:', e.message);
    return 0;
  }
}

async function writeLedgersToDb({ ledgerOps, vendorOps, clientOps }) {
  const results = await Promise.all([
    ledgerOps.length ? AccountsLedger.bulkWrite(ledgerOps, { ordered: false }).catch(e => { ERR('AccountsLedger bulkWrite:', e.message); return null; }) : null,
    vendorOps.length ? Vendor.bulkWrite(vendorOps, { ordered: false }).catch(e => { ERR('Vendor bulkWrite:', e.message); return null; }) : null,
    clientOps.length ? Client.bulkWrite(clientOps, { ordered: false }).catch(e => { ERR('Client bulkWrite:', e.message); return null; }) : null
  ]);
  return results.reduce((s, r) => s + (r ? (r.upsertedCount || 0) + (r.modifiedCount || 0) : 0), 0);
}

// ── Backfill bill-to address/GSTIN from Ledger master when voucher XML didn't carry them ──
// Tally's Collection/Day Book XML often omits BILLTONAME / BILLTOADDRESS / BILLTOGSTIN
// even though the ledger master has full address data. This post-processing step
// looks up the party ledger by name and fills in any blank bill-to fields.
// Ship-to fields are only backfilled if they are also blank (ship-to = bill-to is the common case).
async function backfillBillToFromLedger(vouchers) {
  // Collect unique party names that have missing bill-to data
  const missingNames = new Set();
  for (const v of vouchers) {
    if (!v.billToAddress || !v.billToGST || !v.billToPincode) {
      const name = (v.billToName || v.partyName || '').trim();
      if (name) missingNames.add(name);
    }
  }
  if (missingNames.size === 0) return;

  LOG(`[backfillBillTo] Looking up ledger data for ${missingNames.size} parties with missing bill-to info`);

  // Try AccountsLedger first, then Client
  const ledgerDocs = await AccountsLedger.find(
    { ledgerName: { $in: Array.from(missingNames) } },
    { ledgerName: 1, address: 1, city: 1, state: 1, country: 1, pincode: 1, gstin: 1, gstNumber: 1 }
  ).lean();
  const clientDocs = await Client.find(
    { name: { $in: Array.from(missingNames) } },
    { name: 1, address: 1, city: 1, state: 1, country: 1, pincode: 1, gstin: 1 }
  ).lean();

  // Build lookup map: partyName (lower) → { address, city, state, country, pincode, gstin }
  // AccountsLedger.address is a NESTED OBJECT { street, area, city, state, pincode, country }
  // — flatten it to a plain string for billToAddress.
  const flattenAddr = (addrField) => {
    if (!addrField) return '';
    if (typeof addrField === 'string') return addrField.trim();
    // nested object — join meaningful parts
    const parts = [addrField.street, addrField.area].filter(Boolean);
    return parts.join(', ').trim();
  };
  const ledgerMap = new Map();
  for (const l of ledgerDocs) {
    const key = (l.ledgerName || '').trim().toLowerCase();
    if (!key) continue;
    const addrObj = (typeof l.address === 'object' && l.address !== null) ? l.address : {};
    ledgerMap.set(key, {
      address: flattenAddr(l.address),
      city:    addrObj.city    || l.city    || '',
      state:   addrObj.state   || l.state   || '',
      country: addrObj.country || l.country || '',
      pincode: addrObj.pincode || l.pincode || '',
      gstin:   l.gstin || l.gstNumber || '',
    });
  }
  for (const c of clientDocs) {
    const key = (c.name || '').trim().toLowerCase();
    if (key && !ledgerMap.has(key)) {
      ledgerMap.set(key, {
        address: typeof c.address === 'string' ? c.address.trim() : '',
        city:    c.city    || '',
        state:   c.state   || '',
        country: c.country || '',
        pincode: c.pincode || '',
        gstin:   c.gstin   || '',
      });
    }
  }

  let filled = 0;
  for (const v of vouchers) {
    if (!v.billToAddress || !v.billToGST || !v.billToPincode) {
      const key = (v.billToName || v.partyName || '').trim().toLowerCase();
      const ledger = ledgerMap.get(key);
      if (ledger) {
        if (!v.billToAddress && ledger.address) { v.billToAddress = ledger.address; filled++; }
        if (!v.billToCity    && ledger.city)    v.billToCity    = ledger.city;
        if (!v.billToState   && ledger.state)   v.billToState   = ledger.state;
        if (!v.billToCountry && ledger.country) v.billToCountry = ledger.country;
        if (!v.billToPincode && ledger.pincode) v.billToPincode = ledger.pincode;
        if (!v.billToGST     && ledger.gstin)   v.billToGST     = ledger.gstin;
        // Ship-to: only backfill if also blank — do NOT touch if ship-to already has real data
        if (!v.shipToName    && v.billToName)    v.shipToName    = v.billToName;
        if (!v.shipToAddress && v.billToAddress) v.shipToAddress = v.billToAddress;
        if (!v.shipToCity    && v.billToCity)    v.shipToCity    = v.billToCity;
        if (!v.shipToState   && v.billToState)   v.shipToState   = v.billToState;
        if (!v.shipToCountry && v.billToCountry) v.shipToCountry = v.billToCountry;
        if (!v.shipToGST     && v.billToGST)     v.shipToGST     = v.billToGST;
      }
    }
  }
  LOG(`[backfillBillTo] Backfilled address/GST/pincode data for ${filled} vouchers from ledger master`);
}

async function autoCreateMissingLedgers(vouchers) {
  // Collect all unique ledger names from vouchers
  const ledgerNames = new Set();
  
  vouchers.forEach(voucher => {
    if (voucher.partyName) {
      ledgerNames.add(voucher.partyName);
    }
    voucher.ledgerEntries.forEach(entry => {
      if (entry.ledgerName) {
        ledgerNames.add(entry.ledgerName);
      }
    });
  });
  
  if (ledgerNames.size === 0) {
    return 0;
  }
  
  LOG(`Auto-create: Checking ${ledgerNames.size} unique ledgers from vouchers`);
  
  // Find existing ledgers
  const existingLedgers = await AccountsLedger.find({ 
    ledgerName: { $in: Array.from(ledgerNames) } 
  });
  
  const existingNames = new Set(existingLedgers.map(ledger => ledger.ledgerName));
  
  // Create ops for missing ledgers
  const missingLedgerOps = [];
  Array.from(ledgerNames).forEach(name => {
    if (!existingNames.has(name)) {
      const ledgerCode = `TALLY-${name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 30)}-${Math.random().toString(36).substring(2, 8)}`;
      
      // Try to determine group based on name (fallback to 'Primary')
      let ledgerGroup = 'Primary';
      let ledgerType = 'Other';
      const lowerName = name.toLowerCase();
      
      if (lowerName.includes('cash')) {
        ledgerGroup = 'Cash';
        ledgerType = 'Cash';
      } else if (lowerName.includes('bank')) {
        ledgerGroup = 'Bank';
        ledgerType = 'Bank';
      } else if (lowerName.includes('tax') || lowerName.includes('gst') || lowerName.includes('duty')) {
        ledgerGroup = 'Duties & Taxes';
        ledgerType = 'Duty';
      } else if (lowerName.includes('expense') || lowerName.includes('exp')) {
        ledgerGroup = 'Expenses';
        ledgerType = 'Expense';
      } else if (lowerName.includes('income') || lowerName.includes('revenue') || lowerName.includes('sales')) {
        ledgerGroup = 'Incomes';
        ledgerType = 'Income';
      } else if (lowerName.includes('asset')) {
        ledgerGroup = 'Assets';
        ledgerType = 'Asset';
      } else if (lowerName.includes('liability')) {
        ledgerGroup = 'Liabilities';
        ledgerType = 'Liability';
      }
      
      missingLedgerOps.push({
        updateOne: {
          filter: { ledgerName: name },
          update: {
            $set: {
              ledgerGroup,
              syncedWithTally: true,
              lastTallySync: new Date(),
              dataSource: 'Tally'  // mark as imported from Tally — never export back
            },
            $setOnInsert: {
              ledgerCode,
              ledgerName: name,
              ledgerType,
              contactPerson: name,
              panNumber: 'N/A',
              isActive: true
            }
          },
          upsert: true
        }
      });
    }
  });
  
  if (missingLedgerOps.length > 0) {
    LOG(`Auto-create: Creating ${missingLedgerOps.length} missing ledgers`);
    const result = await AccountsLedger.bulkWrite(missingLedgerOps, { ordered: false });
    LOG(`Auto-create: Done - upserted ${result.upsertedCount} ledgers, modified ${result.modifiedCount}`);
    return result.upsertedCount;
  }
  
  LOG(`Auto-create: No missing ledgers found`);
  return 0;
}

async function writeInvoiceVouchersToDb(ops) {
  if (!ops.length) return 0;
  try {
    const r = await Invoice.bulkWrite(ops, { ordered: false });
    return (r.upsertedCount || 0) + (r.modifiedCount || 0);
  } catch (e) {
    ERR('Invoice bulkWrite:', e.message);
    return 0;
  }
}

async function writeTallyVouchersToDb(ops) {
  if (!ops.length) return 0;
  try {
    const r = await TallyVoucher.bulkWrite(ops, { ordered: false });
    return (r.upsertedCount || 0) + (r.modifiedCount || 0);
  } catch (e) {
    ERR('TallyVoucher bulkWrite:', e.message);
    return 0;
  }
}

// === VOUCHER FETCH CACHE ===
// All voucher types share ONE Collection API response fetched from Tally.
// The Collection API returns ALL vouchers regardless of date range (~14MB).
// Cache is cleared at the start of each import run via clearVoucherCache().
let _voucherXmlCache = null; // { xml: string, timestamp: number }
const VOUCHER_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes (covers entire sync run)
const _chunkXmlCache = new Map(); // date-range key → xml (for chunked requests)

async function getOrFetchAllVouchers(cfg, fromDate, toDate, timeoutMs) {
  const now = Date.now();

  // Collection API returns ALL vouchers regardless of date filters — no point chunking.
  // Cache the single response for the entire sync run so all 8 entity types share it.
  if (
    _voucherXmlCache &&
    _voucherXmlCache.xml &&
    now - _voucherXmlCache.timestamp < VOUCHER_CACHE_TTL_MS
  ) {
    LOG(`[AllVouchers] Using cached XML (${_voucherXmlCache.xml.length} chars)`);
    return _voucherXmlCache.xml;
  }

  LOG(`[AllVouchers] Fetching all vouchers from Tally via Collection API...`);
  const xmlReq = buildAllVouchersCollectionXml(cfg, fromDate, toDate);
  const resp = await postXmlWithRetry(cfg, xmlReq, timeoutMs, MAX_CHUNK_RETRIES);
  LOG(`[AllVouchers] Response length: ${resp?.length || 0} chars`);

  if (resp) _voucherXmlCache = { xml: resp, timestamp: now };
  return resp || '';
}

// Clear the voucher cache (call before starting a new import run)
export function clearVoucherCache() {
  _voucherXmlCache = null;
  _chunkXmlCache.clear();
  LOG('[Cache] Voucher XML cache cleared (full + chunk)');
}

async function fetchAndSave(cfg, entityType, fromDate, toDate, timeoutMs) {
  // Dynamic entity mapping that uses Tally type names, not hardcoded collection names
  const entityConfig = {
    Items: { 
      tallyType: 'StockItem', 
      dynamicCollection: 'DynamicInventory',
      tagPattern: /<STOCKITEM\b|<STOCKITEMS?.LIST\b/i 
    },
    Ledgers: { 
      tallyType: 'Ledger', 
      dynamicCollection: 'DynamicLedger',
      tagPattern: /<LEDGER\b|<LEDGERS?.LIST\b/i 
    },
    Purchase: { 
      tallyType: 'Voucher', 
      tagPattern: /<VOUCHER[\s>]/i, 
      voucherTypes: ['Purchase', 'Purchase Order', 'Purchase Invoice', 'Purchase Bill']
    },
    Sales: { 
      tallyType: 'Voucher', 
      tagPattern: /<VOUCHER[\s>]/i, 
      voucherTypes: ['Sales', 'Sales Order', 'Sales Invoice', 'Sales Bill', 'Tax Invoice', 'GST Sales Invoice', 'GST Invoice', 'Retail Invoice', 'Invoice']
    },
    Payment: { 
      tallyType: 'Voucher', 
      tagPattern: /<VOUCHER[\s>]/i, 
      voucherTypes: ['Payment']
    },
    Receipt: { 
      tallyType: 'Voucher', 
      tagPattern: /<VOUCHER[\s>]/i, 
      voucherTypes: ['Receipt']
    },
    Journal: { 
      tallyType: 'Voucher', 
      tagPattern: /<VOUCHER[\s>]/i, 
      voucherTypes: ['Journal']
    },
    Contra: { 
      tallyType: 'Voucher', 
      tagPattern: /<VOUCHER[\s>]/i, 
      voucherTypes: ['Contra']
    },
    'Debit Note': { 
      tallyType: 'Voucher', 
      tagPattern: /<VOUCHER[\s>]/i, 
      voucherTypes: ['Debit Note']
    },
    'Credit Note': { 
      tallyType: 'Voucher', 
      tagPattern: /<VOUCHER[\s>]/i, 
      voucherTypes: ['Credit Note']
    },
    Vouchers: { 
      tallyType: 'Voucher', 
      tagPattern: /<VOUCHER[\s>]/i, 
      voucherTypes: null 
    }
  };

  const config = entityConfig[entityType];
  if (!config) throw new Error(`Unknown entityType: ${entityType}`);

  let resp;
  
  // ALL voucher types (Purchase, Sales, Payment, Receipt, Journal, Contra, Debit Note, Credit Note)
  // share ONE COLLECTION-based fetch via the cache. This avoids making 8 separate round-trips
  // to Tally for the same data. The first voucher entity fetches and caches; the rest reuse it.
  if (config.tallyType === 'Voucher') {
    resp = await getOrFetchAllVouchers(cfg, fromDate, toDate, timeoutMs);
    LOG(`[${entityType}] Using shared AllVouchers collection (${resp?.length || 0} chars)`);
  } else if (entityType === 'Ledgers') {
    resp = await postXmlWithRetry(cfg, buildLedgerExportXml(cfg), timeoutMs, MAX_CHUNK_RETRIES);
    LOG(`[Ledgers] Collection-based fetch: ${resp?.length || 0} chars`);
    if (resp) {
      LOG(`[Ledgers] First 1500 chars of raw response:`);
      console.log(resp.slice(0, 1500));
    }
  } else if (entityType === 'Items') {
    resp = await postXmlWithRetry(cfg, buildItemExportXml(cfg), timeoutMs, MAX_CHUNK_RETRIES);
    LOG(`[${entityType}] Using Collection-based format (AllStockItems, ${resp?.length || 0} chars)`);
  } else {
    resp = await postXmlWithRetry(cfg, buildDynamicCollectionXml(cfg, config.tallyType, config.tallyType + 'Collection', null, fromDate, toDate), timeoutMs, MAX_CHUNK_RETRIES);
    LOG(`[${entityType}] Using dynamic TDL collection (${resp?.length || 0} chars)`);
  }

  const hasMatchingTag = resp && config.tagPattern.test(resp);
  LOG(`[${entityType}] contains expected tag: ${hasMatchingTag}`);

  if (!resp) {
    // Empty string response (Tally returned STATUS=0 or blank) — treat as a real error
    // so the caller can retry rather than silently marking 0 records as "success".
    throw new Error(`Tally returned an empty response for ${entityType} — Tally may be busy or the company is not open`);
  }

  if (!config.tagPattern.test(resp)) {
    LOG(`No ${entityType} data found in response (${resp.length} bytes, no matching tag). Treating as empty dataset.`);
    return { records: 0, complete: true, created: 0, updated: 0, skipped: 0, failed: 0, totalFound: 0 };
  }

  let records = 0;
  let totalFound = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  if (entityType === 'Items') {
    LOG(`[Tally] Parsing stock items`);
    const parsed = parseStockItems(resp);
    totalFound = parsed.length;
    
    // Step 1: Generate itemId using full GUID (no truncation), skip items without GUID
    const itemsWithIds = parsed.map(({ name, guid, alterId, hsn, gst, unit, cost, openingStock, openingValue, closingBalance, closingValue, gstApplicable }) => {
      if (!guid) {
        LOG('Skipping stock item without GUID:', name);
        return null;
      }
      const UNIT_MAP = { Nos: 'units', Kg: 'kg', Ltr: 'liter', Mtr: 'meter', Box: 'box', Pcs: 'piece' };
      const cleanGuid = guid.replace(/[^A-Z0-9]/gi, ''); // Full GUID, no truncation
      const sku = `TALLY-${cleanGuid}`;
      const itemId = `TALLY-${cleanGuid}`;
      const filter = { tallyGuid: guid };
      return { name, guid, alterId, hsn, gst, unit, cost, openingStock, openingValue, closingBalance, closingValue, gstApplicable, cleanGuid, sku, itemId, filter };
    }).filter(Boolean);

    // Step 2: Remove duplicates from parsed items array using itemId
    const uniqueItemsMap = new Map();
    itemsWithIds.forEach(item => {
      uniqueItemsMap.set(item.itemId, item);
    });
    const uniqueItems = Array.from(uniqueItemsMap.values());
    const duplicatesRemoved = itemsWithIds.length - uniqueItems.length;

    LOG(`[Tally] Total fetched items: ${totalFound}, skipped (no GUID): ${totalFound - itemsWithIds.length}, duplicates removed: ${duplicatesRemoved}, unique items to process: ${uniqueItems.length}`);

    // Step 3: Create bulk operations
    const ops = uniqueItems.map(({ name, guid, alterId, hsn, gst, unit, cost, openingStock, openingValue, closingBalance, closingValue, gstApplicable, sku, itemId, filter }) => {
      const UNIT_MAP = { Nos: 'units', Kg: 'kg', Ltr: 'liter', Mtr: 'meter', Box: 'box', Pcs: 'piece' };
      return {
        updateOne: {
          filter,
          update: {
            $set: {
              itemId,  // Always update itemId and sku to correct values
              sku,
              itemName: name,
              tallyGuid: guid,
              tallyAlterId: alterId,
              hsn, gst, unit: UNIT_MAP[unit] || 'units', costPrice: cost, unitPrice: cost,
              openingStock,
              openingValue: openingValue || 0,
              closingBalance: closingBalance || '0',
              closingValue: closingValue || '0',
              gstApplicable,
              tallySynced: true, lastTallySync: new Date(),
              dataSource: 'Tally'  // mark as imported from Tally — never export back
            },
            $setOnInsert: { name, sellingPrice: cost, isActive: true }
          },
          upsert: true
        }
      };
    });
    
    if (ops.length > 0) {
      try {
        const result = await ItemMaster.bulkWrite(ops, { ordered: false });
        created = result.upsertedCount || 0;
        updated = result.modifiedCount || 0;
        records = created + updated;
        skipped = duplicatesRemoved;
        failed = totalFound - records - duplicatesRemoved;
        LOG(`[Tally] Sync complete - created: ${created}, updated: ${updated}, skipped (duplicates): ${skipped}, failed: ${failed}`);
      } catch (e) {
        ERR('ItemMaster bulkWrite:', e.message);
        failed = totalFound;
      }
    }
  } else if (entityType === 'Ledgers') {
    const parsed = parseLedgers(resp);
    totalFound = parsed.length;
    const { ledgerOps, vendorOps, clientOps } = ledgersToOps(parsed);
    
    let ledgerResult = null, vendorResult = null, clientResult = null;
    
    if (ledgerOps.length > 0) {
      try {
        ledgerResult = await AccountsLedger.bulkWrite(ledgerOps, { ordered: false });
      } catch (e) {
        ERR('AccountsLedger bulkWrite:', e.message);
      }
    }
    
    if (vendorOps.length > 0) {
      try {
        vendorResult = await Vendor.bulkWrite(vendorOps, { ordered: false });
      } catch (e) {
        ERR('Vendor bulkWrite:', e.message);
      }
    }
    
    if (clientOps.length > 0) {
      try {
        clientResult = await Client.bulkWrite(clientOps, { ordered: false });
      } catch (e) {
        ERR('Client bulkWrite:', e.message);
      }
    }
    
    created = (ledgerResult?.upsertedCount || 0) + (vendorResult?.upsertedCount || 0) + (clientResult?.upsertedCount || 0);
    updated = (ledgerResult?.modifiedCount || 0) + (vendorResult?.modifiedCount || 0) + (clientResult?.modifiedCount || 0);
    records = created + updated;
    skipped = 0;
    failed = totalFound - records;
  } else if (['Purchase', 'Sales'].includes(entityType)) {
    LOG(`[${entityType}] Starting voucher parsing with type filter: ${config.voucherTypes?.join(', ')}`);
    LOG(`[${entityType}] Raw response length: ${resp?.length || 0}`);
    const { vouchers: parsed, mismatchedCount, failedCount } = parseVouchers(resp, config.voucherTypes);
    LOG(`[${entityType}] Parsed vouchers: ${parsed.length}, mismatched (other types): ${mismatchedCount}, parse-failed: ${failedCount}`);
    // totalFound = all vouchers in the shared XML response for this type's pass
    totalFound = parsed.length;  // only count vouchers that matched this type
    skipped = 0;                 // "mismatched" are handled by other entity passes — not truly skipped
    failed = failedCount;        // only XML-parse failures count as failed initially
    await autoCreateMissingLedgers(parsed);
    await backfillBillToFromLedger(parsed);

    // Save to Invoice model (for ERP invoice management)
    const invoiceOps = vouchersToInvoiceOps(parsed);
    LOG(`[${entityType}] Created ${invoiceOps.length} invoice ops`);
    
    if (invoiceOps.length > 0) {
      try {
        const result = await Invoice.bulkWrite(invoiceOps, { ordered: false });
        created = result.upsertedCount || 0;
        updated = result.modifiedCount || 0;
        records = created + updated;
        // Count individual write errors from the result
        const writeErrors = result.getWriteErrors ? result.getWriteErrors() : [];
        if (writeErrors.length > 0) {
          failed += writeErrors.length;
          LOG(`[${entityType}] Invoice bulkWrite errors (${writeErrors.length}): ${writeErrors[0]?.errmsg || ''}`);
        }
        LOG(`[${entityType}] Invoice bulkWrite - created: ${created}, updated: ${updated}, errors: ${writeErrors.length}`);
      } catch (e) {
        ERR('Invoice bulkWrite:', e.message);
        failed += parsed.length;
      }
    }

    // ALSO save to TallyVoucher model so Finance → Tally Ledger → Vouchers tab shows them
    const tallyVoucherOps = vouchersToTallyVoucherOps(parsed);
    LOG(`[${entityType}] Created ${tallyVoucherOps.length} tallyVoucher ops (for Finance UI)`);
    if (tallyVoucherOps.length > 0) {
      try {
        const tvResult = await TallyVoucher.bulkWrite(tallyVoucherOps, { ordered: false });
        LOG(`[${entityType}] TallyVoucher bulkWrite - created: ${tvResult.upsertedCount || 0}, updated: ${tvResult.modifiedCount || 0}`);
        const tvErrors = tvResult.getWriteErrors ? tvResult.getWriteErrors() : [];
        if (tvErrors.length > 0) {
          LOG(`[${entityType}] TallyVoucher write errors (${tvErrors.length}): ${tvErrors[0]?.errmsg || ''}`);
        }
      } catch (e) {
        ERR(`TallyVoucher bulkWrite for ${entityType}:`, e.message);
      }
    }
  } else if (['Payment', 'Receipt', 'Journal', 'Contra', 'Debit Note', 'Credit Note'].includes(entityType)) {
    LOG(`[${entityType}] Starting voucher parsing with type filter: ${config.voucherTypes?.join(', ')}`);
    LOG(`[${entityType}] Raw response length: ${resp?.length || 0}`);
    const { vouchers: parsed, mismatchedCount, failedCount } = parseVouchers(resp, config.voucherTypes);
    LOG(`[${entityType}] Parsed vouchers: ${parsed.length}, mismatched (other types): ${mismatchedCount}, parse-failed: ${failedCount}`);
    totalFound = parsed.length;   // only count vouchers that matched this type
    skipped = 0;                  // "mismatched" are handled by other entity passes — not truly skipped
    failed = failedCount;
    await autoCreateMissingLedgers(parsed);
    await backfillBillToFromLedger(parsed);
    const ops = vouchersToTallyVoucherOps(parsed);
    LOG(`[${entityType}] Created ${ops.length} tally voucher ops`);
    
    if (ops.length > 0) {
      try {
        const result = await TallyVoucher.bulkWrite(ops, { ordered: false });
        created = result.upsertedCount || 0;
        updated = result.modifiedCount || 0;
        records = created + updated;
        const writeErrors = result.getWriteErrors ? result.getWriteErrors() : [];
        if (writeErrors.length > 0) {
          failed += writeErrors.length;
          LOG(`[${entityType}] TallyVoucher bulkWrite errors (${writeErrors.length}): ${writeErrors[0]?.errmsg || ''}`);
        }
        LOG(`[${entityType}] TallyVoucher bulkWrite - created: ${created}, updated: ${updated}, errors: ${writeErrors.length}`);
      } catch (e) {
        ERR('TallyVoucher bulkWrite:', e.message);
        failed += parsed.length;
      }
    }
  } else if (entityType === 'Vouchers') {
    const { vouchers: parsed, mismatchedCount, failedCount } = parseVouchers(resp, null);
    totalFound = parsed.length;
    skipped = 0;   // in the catch-all Vouchers pass there are no "other-type" skips
    failed = failedCount;
    await autoCreateMissingLedgers(parsed);
    await backfillBillToFromLedger(parsed);
    const salesPur = parsed.filter(v => ['Sales', 'Purchase'].some(t => normaliseVoucherType(v.voucherType) === t));
    const payRec   = parsed.filter(v => ['Payment', 'Receipt', 'Journal', 'Contra', 'Debit Note', 'Credit Note'].some(t => normaliseVoucherType(v.voucherType) === t));

    let invoiceResult = null, tallyVoucherResult = null, tvSalesPurResult = null;
    const invoiceOps = vouchersToInvoiceOps(salesPur);
    if (invoiceOps.length > 0) {
      try {
        invoiceResult = await Invoice.bulkWrite(invoiceOps, { ordered: false });
      } catch (e) {
        ERR('Invoice bulkWrite:', e.message);
      }
    }

    // Sales/Purchase also saved to TallyVoucher so Finance → Tally Ledger → Vouchers tab shows amounts
    const tvSalesPurOps = vouchersToTallyVoucherOps(salesPur);
    if (tvSalesPurOps.length > 0) {
      try {
        tvSalesPurResult = await TallyVoucher.bulkWrite(tvSalesPurOps, { ordered: false });
      } catch (e) {
        ERR('TallyVoucher bulkWrite (Sales/Purchase):', e.message);
      }
    }

    const tallyVoucherOps = vouchersToTallyVoucherOps(payRec);
    if (tallyVoucherOps.length > 0) {
      try {
        tallyVoucherResult = await TallyVoucher.bulkWrite(tallyVoucherOps, { ordered: false });
      } catch (e) {
        ERR('TallyVoucher bulkWrite:', e.message);
      }
    }

    created = (invoiceResult?.upsertedCount || 0) + (tvSalesPurResult?.upsertedCount || 0) + (tallyVoucherResult?.upsertedCount || 0);
    updated = (invoiceResult?.modifiedCount || 0) + (tvSalesPurResult?.modifiedCount || 0) + (tallyVoucherResult?.modifiedCount || 0);
    records = created + updated;
    // failed stays as failedCount (parse failures only)
  }

  LOG(`${entityType} - Total Found: ${totalFound}, Created: ${created}, Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`);
  return { records, complete: true, created, updated, skipped, failed, totalFound };
}

// === FULL FETCH ===
async function tryFullFetch(cfg, state, entityType, timeoutMs, startDate = null, endDate = null) {
  LOG(`Entity Started: ${entityType}`);
  LOG(`Trying full fetch for ${entityType}`);
  // Use HISTORY_START_DATE as the baseline if no startDate provided
  const effectiveFrom = startDate || new Date(HISTORY_START_DATE);
  const effectiveTo   = endDate   || new Date();
  LOG(`${entityType} full fetch date range: ${td(effectiveFrom)} → ${td(effectiveTo)}`);

  // Safety net: never send an inverted date range to Tally.
  // An inverted range (from > to) causes Tally to return ALL vouchers regardless of
  // the filter, which can produce a 19MB+ response that OOMs the server.
  if (effectiveFrom > effectiveTo) {
    LOG(`${entityType} full fetch skipped — date range is inverted (${td(effectiveFrom)} > ${td(effectiveTo)}). Nothing new to sync.`);
    return { ok: true, records: 0, created: 0, updated: 0, skipped: 0, failed: 0, totalFound: 0 };
  }
  try {
    const { records, created, updated, skipped, failed, totalFound } = await fetchAndSave(cfg, entityType, effectiveFrom, effectiveTo, timeoutMs);
    state.usedFullFetch = true;
    state.syncStatus = 'completed';
    state.totalRecords = records;
    state.lastSuccessAt = new Date();
    state.lastSyncedDate = new Date();
    state.chunks = [];
    state.lastCompletedChunkIndex = -1;
    await state.save();
    LOG(`Entity Success: ${entityType}`);
    return { ok: true, records, created, updated, skipped, failed, totalFound };
  } catch (err) {
    ERR(`Entity Failed: ${entityType}`, err);
    return { ok: false, records: 0, created: 0, updated: 0, skipped: 0, failed: 0, totalFound: 0, reason: err.message, error: err.message };
  }
}

// === CHUNK SYNC ===
async function runChunkSync(cfg, state, entityType, fromDate, toDate, timeoutMs) {
  LOG(`Starting chunk sync for ${entityType}: ${td(fromDate)} → ${td(toDate)}`);
  const sameWindow = state.syncWindowStart?.toDateString() === fromDate.toDateString() &&
                     state.syncWindowEnd?.toDateString() === toDate.toDateString() &&
                     state.chunks.length > 0;

  if (!sameWindow) {
    state.chunks = buildChunks(fromDate, toDate);
    state.lastCompletedChunkIndex = -1;
    state.syncWindowStart = fromDate;
    state.syncWindowEnd = toDate;
    state.totalRecords = 0;
    state.totalCreated = 0;
    state.totalUpdated = 0;
    state.totalSkipped = 0;
    state.totalFailed = 0;
    state.totalTotalFound = 0;
    await state.save();
  } else {
    LOG(`Resuming chunk sync for ${entityType} from chunk ${state.lastCompletedChunkIndex + 1}`);
  }

  let totalRecords = state.totalRecords || 0;
  let totalCreated = state.totalCreated || 0;
  let totalUpdated = state.totalUpdated || 0;
  let totalSkipped = state.totalSkipped || 0;
  let totalFailed = state.totalFailed || 0;
  let totalTotalFound = state.totalTotalFound || 0;
  let failedChunks = 0;

  for (let i = state.lastCompletedChunkIndex + 1; i < state.chunks.length; i++) {
    const chunk = state.chunks[i];
    if (chunk.status === 'success') {
      totalRecords += chunk.records || 0;
      totalCreated += chunk.created || 0;
      totalUpdated += chunk.updated || 0;
      totalSkipped += chunk.skipped || 0;
      totalFailed += chunk.failed || 0;
      totalTotalFound += chunk.totalFound || 0;
      continue;
    }
    LOG(`Chunk Started ${i+1}/${state.chunks.length}: ${td(chunk.fromDate)} → ${td(chunk.toDate)}`);
    chunk.attempts = (chunk.attempts || 0) + 1;
    chunk.status = 'pending';

    let chunkOk = false;
    let lastChunkErr = '';
    let chunkRecords = 0;
    let chunkCreated = 0;
    let chunkUpdated = 0;
    let chunkSkipped = 0;
    let chunkFailed = 0;
    let chunkTotalFound = 0;

    for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
      try {
        const { records, complete, created, updated, skipped, failed, totalFound } = await fetchAndSave(cfg, entityType, chunk.fromDate, chunk.toDate, timeoutMs);
        chunkRecords = records;
        chunk.records = records;
        chunkCreated = created;
        chunk.created = created;
        chunkUpdated = updated;
        chunk.updated = updated;
        chunkSkipped = skipped;
        chunk.skipped = skipped;
        chunkFailed = failed;
        chunk.failed = failed;
        chunkTotalFound = totalFound;
        chunk.totalFound = totalFound;
        if (!complete) {
          const halfDays = Math.ceil(CHUNK_DAYS / 2);
          if (halfDays >= 3) {
            LOG(`${entityType} chunk ${i} truncated, splitting to ${halfDays} days`);
            const subChunks = buildChunks(chunk.fromDate, chunk.toDate, halfDays);
            let subRecords = 0;
            let subCreated = 0;
            let subUpdated = 0;
            let subSkipped = 0;
            let subFailed = 0;
            let subTotalFound = 0;
            let subAllOk = true;
            for (const sc of subChunks) {
              try {
                const sr = await fetchAndSave(cfg, entityType, sc.fromDate, sc.toDate, timeoutMs);
                subRecords += sr.records;
                subCreated += sr.created || 0;
                subUpdated += sr.updated || 0;
                subSkipped += sr.skipped || 0;
                subFailed += sr.failed || 0;
                subTotalFound += sr.totalFound || 0;
              } catch (scErr) {
                ERR('Sub-chunk failed:', scErr);
                subAllOk = false;
              }
            }
            chunkRecords = subRecords;
            chunk.records = subRecords;
            chunkCreated = subCreated;
            chunk.created = subCreated;
            chunkUpdated = subUpdated;
            chunk.updated = subUpdated;
            chunkSkipped = subSkipped;
            chunk.skipped = subSkipped;
            chunkFailed = subFailed;
            chunk.failed = subFailed;
            chunkTotalFound = subTotalFound;
            chunk.totalFound = subTotalFound;
            chunkOk = subAllOk;
          } else {
            chunkOk = true;
          }
        } else {
          chunkOk = true;
        }
        if (chunkOk) break;
      } catch (err) {
        lastChunkErr = err.message;
        ERR(`${entityType} chunk ${i} attempt ${attempt+1} failed:`, err);
        if (attempt < MAX_CHUNK_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        }
      }
    }

    if (chunkOk) {
      chunk.status = 'success';
      chunk.completedAt = new Date();
      chunk.lastError = '';
      totalRecords += chunkRecords;
      totalCreated += chunkCreated;
      totalUpdated += chunkUpdated;
      totalSkipped += chunkSkipped;
      totalFailed += chunkFailed;
      totalTotalFound += chunkTotalFound;
      state.lastCompletedChunkIndex = i;
      state.totalRecords = totalRecords;
      state.totalCreated = totalCreated;
      state.totalUpdated = totalUpdated;
      state.totalSkipped = totalSkipped;
      state.totalFailed = totalFailed;
      state.totalTotalFound = totalTotalFound;
      LOG(`Chunk Success ${i+1}/${state.chunks.length}: ${entityType}`);
    } else {
      chunk.status = 'failed';
      chunk.lastError = lastChunkErr;
      failedChunks++;
      LOG(`Chunk Failed ${i+1}/${state.chunks.length}: ${entityType}`);
    }
    state.markModified('chunks');
    await state.save();
  }

  const allDone = state.chunks.every(c => c.status === 'success' || c.status === 'failed');
  const anyFailed = failedChunks > 0;
  state.syncStatus = allDone ? (anyFailed ? 'partial' : 'completed') : 'running';
  state.usedFullFetch = false;
  state.totalRecords = totalRecords;
  state.totalCreated = totalCreated;
  state.totalUpdated = totalUpdated;
  state.totalSkipped = totalSkipped;
  state.totalFailed = totalFailed;
  state.totalTotalFound = totalTotalFound;
  if (!anyFailed) {
    state.lastSuccessAt = new Date();
    state.lastSyncedDate = toDate;
  }
  await state.save();
  LOG(`${entityType} chunk sync complete: ${totalRecords} records, ${failedChunks} failed chunks`);
  return {
    ok: !anyFailed || totalRecords > 0, records: totalRecords, failedChunks, error: anyFailed ? `${failedChunks} chunks failed` : undefined, created: totalCreated, updated: totalUpdated, skipped: totalSkipped, failed: totalFailed, totalFound: totalTotalFound
  };
}

// === PULL ENTITY ===
export async function pullEntityFromTally(entityType, options = {}) {
  const start = Date.now();
  const syncId = `PULL-${entityType.toUpperCase()}-${Date.now()}`;
  const logType = entityType === 'Items' ? 'Item Master' : entityType;
  const timeout = ENTITY_TIMEOUTS[entityType] || 60000;
  LOG(`Entity Timeout = ${timeout} ms`);
  let state;
  try {
    await acquireLock();
    const cfg = await getCfg();
    state = await getOrCreateState(entityType);
    state.syncStatus = 'running';
    state.syncStartedAt = new Date();
    await state.save();

    const isTimeless = entityType === 'Items' || entityType === 'Ledgers';
    // Voucher Collection API returns ALL vouchers regardless of date range.
    // So chunking adds no value — one full fetch is sufficient.
    // The shared _chunkXmlCache (keyed by date range) ensures all 8 voucher entity
    // types share the same XML response from a single Tally request per sync run.
    const isVoucherEntity = !isTimeless;

    const today = new Date();
    const endDate = options.endDate ? new Date(options.endDate) : today;
    let startDate = options.startDate ? new Date(options.startDate) : null;

    if (!startDate) {
      if (state.lastSyncedDate && !options.forceRefresh) {
        startDate = new Date(state.lastSyncedDate);
        startDate.setDate(startDate.getDate() + 1);
        // Guard: if the computed startDate is after endDate (happens when the last sync
        // completed on the same day as today), clamp it back to endDate so the date
        // range is never inverted.  An inverted range causes Tally to return ALL
        // vouchers instead of zero, which OOMs the server on large datasets.
        if (startDate > endDate) {
          LOG(`${entityType} incremental startDate ${td(startDate)} > endDate ${td(endDate)} — clamping to endDate (nothing new to sync)`);
          startDate = new Date(endDate);
        } else {
          LOG(`${entityType} incremental sync from ${td(startDate)}`);
        }
      } else {
        // Always start from April 1, 2024 (HISTORY_START_DATE) to ensure
        // complete historical data is fetched across all FY periods.
        // cfg.financialYearStart can override this if explicitly set.
        if (cfg.financialYearStart) {
          startDate = new Date(cfg.financialYearStart);
          LOG(`${entityType} using configured financial year start: ${td(startDate)}`);
        } else {
          startDate = new Date(HISTORY_START_DATE);
          LOG(`${entityType} using history baseline start: ${td(startDate)}`);
        }
      }
    }
    let result;
    
    if (entityType === 'Items') {
      // Special handling for Items: only use tryFullFetch, no chunks!
      result = await tryFullFetch(cfg, state, entityType, timeout, startDate, endDate);
      const status = result.ok ? 'Success' : 'Failed';
      const duration = `${((Date.now() - start)/1000).toFixed(1)}s`;
      await writeSyncLog({ syncId, type: logType, direction: 'Tally → ERP', status, duration, error: result.error, records: result.records });
      await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date() }, { sort: { _id: 1 }, upsert: true });
      releaseLock();
      await new Promise(r => setTimeout(r, 1000));
      return { ok: result.ok, records: result.records, usedChunks: false, error: result.error || result.reason, created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed, totalFound: result.totalFound };
    }

    // Regular handling for other entities
    // Voucher entities use tryFullFetch — Collection API returns ALL vouchers in one shot.
    // The _chunkXmlCache ensures the 14MB response is fetched only once per sync run
    // and shared across all voucher entity types (Sales, Purchase, Payment, etc.)
    if (!options.forceChunk) {
      result = await tryFullFetch(cfg, state, entityType, timeout, startDate, endDate);
      if (result.ok) {
        await writeSyncLog({ syncId, type: logType, direction: 'Tally → ERP', status: 'Success', duration: `${((Date.now() - start)/1000).toFixed(1)}s`, records: result.records });
        await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date() }, { sort: { _id: 1 }, upsert: true });
        releaseLock();
        await new Promise(r => setTimeout(r, 1000));
        return { ok: true, records: result.records, usedChunks: false, created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed, totalFound: result.totalFound };
      }
      LOG(`${entityType} full fetch not viable (${result.reason}), switching to chunks`);
    }
    const windowStart = isTimeless ? (() => { let d = new Date(HISTORY_START_DATE); return d; })() : startDate;
    result = await runChunkSync(cfg, state, entityType, windowStart, endDate, timeout);
    const status = result.ok ? (result.failedChunks > 0 ? 'Partial' : 'Success') : 'Failed';
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeSyncLog({ syncId, type: logType, direction: 'Tally → ERP', status, duration, error: result.error, records: result.records });
    await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date() }, { sort: { _id: 1 }, upsert: true });
    releaseLock();
    await new Promise(r => setTimeout(r, 1000));
    return { ok: result.ok, records: result.records, usedChunks: true, failedChunks: result.failedChunks, created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed, totalFound: result.totalFound };
  } catch (err) {
    ERR(`pullEntityFromTally ${entityType} FATAL:`, err);
    if (state) {
      state.syncStatus = 'failed';
      state.lastError = err.message;
      await state.save();
    }
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeSyncLog({ syncId, type: logType, direction: 'Tally → ERP', status: 'Failed', duration, error: err.message, records: 0 });
    releaseLock();
    return { ok: false, records: 0, error: err.message, created: 0, updated: 0, skipped: 0, failed: 0, totalFound: 0 };
  }
}

