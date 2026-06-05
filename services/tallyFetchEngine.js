
import axios from 'axios';
import TallyConfig    from '../models/TallyConfig.js';
import TallySyncState from '../models/TallySyncState.js';
import TallySyncLog   from '../models/TallySyncLog.js';
import ItemMaster     from '../models/ItemMaster.js';
import AccountsLedger from '../models/AccountsLedger.js';
import Vendor         from '../models/Vendor.js';
import Client         from '../models/Client.js';
import Invoice        from '../models/Invoice.js';
import TallyVoucher   from '../models/TallyVoucher.js';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const CHUNK_DAYS        = 15;   // days per date-range chunk
const MAX_CHUNK_RETRIES = 3;    // retry each chunk up to 3 times
const FULL_FETCH_TIMEOUT= 60000;// 60s for full-fetch attempt
const CHUNK_TIMEOUT     = 45000;// 45s per chunk
const MIN_RESPONSE_BYTES= 200;  // smaller → treat as empty/error
// If response is < this ratio of the first attempt → assume truncation
const TRUNCATION_RATIO  = 0.85;

const LOG = (...a) => console.log('[TallyFetch]', ...a);
const ERR = (...a) => console.error('[TallyFetch ERROR]', ...a);

// ─── CONFIG HELPERS ───────────────────────────────────────────────────────────

async function getCfg() {
  let cfg = await TallyConfig.findOne();
  if (!cfg) cfg = await TallyConfig.create({});
  return cfg;
}

function tallyBaseUrl(cfg) {
  const local = (cfg.tallyLocalUrl || '').trim();
  const port  = cfg.port || '9000';
  if (!local) throw new Error('tallyLocalUrl not set in TallyConfig. Go to Tally → Configuration and set the Tally machine URL.');
  if (local.startsWith('https://')) return local.replace(/\/$/, '');
  if (local.match(/:\d+$/)) return local.replace(/\/$/, '');
  return `${local.replace(/\/$/, '')}:${port}`;
}

function buildHeaders(cfg) {
  const h = { 'Content-Type': 'text/xml', Accept: '*/*' };
  if (cfg.authType === 'Basic Auth' && cfg.apiKey)
    h['Authorization'] = `Basic ${Buffer.from(cfg.apiKey).toString('base64')}`;
  else if (cfg.authType === 'API Key' && cfg.apiKey)
    h['Authorization'] = `Bearer ${cfg.apiKey}`;
  return h;
}

// ─── HTTP POST ────────────────────────────────────────────────────────────────

async function postXml(cfg, xml, timeoutMs = CHUNK_TIMEOUT) {
  const url = tallyBaseUrl(cfg);
  LOG(`POST ${url}  bytes=${xml.length}  timeout=${timeoutMs}ms`);
  const resp = await axios({
    method: 'POST', url,
    data: xml,
    headers: buildHeaders(cfg),
    timeout: timeoutMs,
    responseType: 'text',
    validateStatus: () => true,
    maxRedirects: 5,
  });
  const body = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
  LOG(`  → HTTP ${resp.status}  bytes=${body.length}  preview: ${body.slice(0, 150)}`);
  return body;
}

// Retry wrapper — up to `attempts` tries with exponential back-off
async function postXmlWithRetry(cfg, xml, timeoutMs, attempts = MAX_CHUNK_RETRIES) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const body = await postXml(cfg, xml, timeoutMs);
      if (body && body.length >= MIN_RESPONSE_BYTES) return body;
      lastErr = new Error(`Response too short (${body.length} bytes)`);
    } catch (err) {
      lastErr = err;
      ERR(`Attempt ${i + 1}/${attempts} failed: ${err.message}`);
    }
    if (i < attempts - 1) {
      const delay = 2000 * Math.pow(2, i); // 2s, 4s, 8s
      LOG(`  Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─── XML HELPERS ──────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Convert Date → Tally date string YYYYMMDD
function td(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

function extractGuid(block) {
  const m = block.match(/<GUID>(.*?)<\/GUID>/i);
  return m ? m[1].trim() : null;
}
function extractAlterId(block) {
  const m = block.match(/<ALTERID[^>]*>(.*?)<\/ALTERID>/i);
  return m ? m[1].trim() : null;
}

// ─── RESPONSE COMPLETENESS CHECK ─────────────────────────────────────────────
// Detect truncated XML by looking for unclosed root tags or anomalies.

function isResponseComplete(xml) {
  if (!xml || xml.length < MIN_RESPONSE_BYTES) return false;
  const trimmed = xml.trimEnd();
  // Tally XML should end with </ENVELOPE> or </TALLYMESSAGE>
  if (trimmed.endsWith('</ENVELOPE>') || trimmed.endsWith('</TALLYMESSAGE>')) return true;
  // Sometimes Tally returns error envelopes — still valid
  if (trimmed.endsWith('</LINEERROR>') || trimmed.endsWith('</ERRORS>')) return true;
  // Check that the XML isn't cut mid-tag
  const lastAngle = trimmed.lastIndexOf('<');
  if (lastAngle > trimmed.length - 50) {
    const tail = trimmed.slice(lastAngle);
    if (!tail.includes('>')) {
      ERR('Response appears truncated — last 100 chars:', trimmed.slice(-100));
      return false;
    }
  }
  return true;
}

// ─── DATE CHUNK GENERATOR ─────────────────────────────────────────────────────
// Splits a date range into CHUNK_DAYS-sized windows.
// Example: Jan 1 → Mar 1 with 15-day chunks → 4 chunks

function buildChunks(fromDate, toDate, chunkDays = CHUNK_DAYS) {
  const chunks = [];
  let cursor = new Date(fromDate);
  const end  = new Date(toDate);
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

// ─── SYNC STATE HELPERS ───────────────────────────────────────────────────────

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
  } catch (_) { /* non-fatal */ }
}

// ─── XML REQUEST BUILDERS ─────────────────────────────────────────────────────

function companyTag(cfg) {
  const co = (cfg.companyName || '').trim();
  return co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : '';
}

// Full fetch — no date filter, asks Tally for everything
function buildFullFetchXml(cfg, reportName, extraVars = '') {
  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>${reportName}</REPORTNAME>
      <STATICVARIABLES>
        ${companyTag(cfg)}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${extraVars}
      </STATICVARIABLES>
    </REQUESTDESC>
  </EXPORTDATA></BODY>
</ENVELOPE>`;
}

// Chunk fetch — date-filtered request
function buildChunkFetchXml(cfg, reportName, fromDate, toDate, extraVars = '') {
  const from = td(fromDate);
  const to   = td(toDate);
  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>${reportName}</REPORTNAME>
      <STATICVARIABLES>
        ${companyTag(cfg)}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVFROMDATE>${from}</SVFROMDATE>
        <SVTODATE>${to}</SVTODATE>
        ${extraVars}
      </STATICVARIABLES>
    </REQUESTDESC>
  </EXPORTDATA></BODY>
</ENVELOPE>`;
}

// ─── PARSERS (XML → JS objects) ───────────────────────────────────────────────

function parseStockItems(xml) {
  const items = [];
  for (const m of xml.matchAll(/<STOCKITEM[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/STOCKITEM>/gi)) {
    const name = m[1]?.trim();
    if (!name) continue;
    const block   = m[2];
    const guid    = extractGuid(block);
    const alterId = extractAlterId(block);
    const hsn     = (block.match(/<HSNCODE>(.*?)<\/HSNCODE>/i)?.[1] || '').trim();
    const gst     = parseFloat(block.match(/<GSTRATE>(.*?)<\/GSTRATE>/i)?.[1]) || 0;
    const unit    = (block.match(/<BASEUNITS>(.*?)<\/BASEUNITS>/i)?.[1] || 'Nos').trim();
    const cost    = parseFloat(block.match(/<STANDARDCOST>(.*?)<\/STANDARDCOST>/i)?.[1]) || 0;
    items.push({ name, guid, alterId, hsn, gst, unit, cost });
  }
  return items;
}

const UNIT_MAP = { Nos:'units', Kg:'kg', Ltr:'liter', Mtr:'meter', Box:'box', Pcs:'piece' };

function itemsToOps(items) {
  return items.map(({ name, guid, alterId, hsn, gst, unit, cost }) => {
    const sku      = name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 30);
    // Unique barcode per item — avoids sparse-unique index collision on empty string
    const barcodeVal = guid
      ? `TALLY-${guid.replace(/[^A-Z0-9]/gi, '').slice(0, 20)}`
      : `TALLY-${sku}-${Date.now() % 100000}`;
    const filter = guid ? { tallyGuid: guid } : { name };
    return { updateOne: {
      filter,
      update: {
        $set: {
          hsn, gst, unit: UNIT_MAP[unit] || 'units', costPrice: cost, unitPrice: cost,
          tallySynced: true, lastTallySync: new Date(), status: 'Active', isActive: true,
          ...(guid     ? { tallyGuid: guid }         : {}),
          ...(alterId  ? { tallyAlterId: alterId }   : {}),
        },
        $setOnInsert: { itemId: `TALLY-${sku}`, sku, name, sellingPrice: cost, barcode: barcodeVal },
      },
      upsert: true,
    }};
  });
}

/**
 * Decode XML entities from Tally response strings.
 * Tally sometimes double-encodes: &amp;amp; → &amp; → &
 */
function decodeXmlEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/gi,  '&')
    .replace(/&lt;/gi,   '<')
    .replace(/&gt;/gi,   '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    // Second pass — handles double-encoded &amp;amp; → &amp; → &
    .replace(/&amp;/gi,  '&')
    .replace(/&lt;/gi,   '<')
    .replace(/&gt;/gi,   '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

/**
 * Parse address lines from a Tally ledger XML block.
 * Tally stores address as multiple <ADDRESS> tags inside <ADDRESS.LIST>.
 * Lines are: street, area, city+state+pincode combined, country.
 * We also try dedicated tags: <LEDGERCITY>, <STATENAME>, <PINCODE>, <COUNTRYNAME>.
 */
function parseTallyAddress(block) {
  // Collect all <ADDRESS> lines
  const lines = [...block.matchAll(/<ADDRESS>([\s\S]*?)<\/ADDRESS>/gi)]
    .map(m => decodeXmlEntities(m[1].trim()))
    .filter(Boolean);

  // Try dedicated tags first
  const city    = decodeXmlEntities((block.match(/<LEDGERCITY>(.*?)<\/LEDGERCITY>/i)?.[1] || '').trim());
  const state   = decodeXmlEntities((block.match(/<STATENAME>(.*?)<\/STATENAME>/i)?.[1] ||
                   block.match(/<LEDGERSTATE>(.*?)<\/LEDGERSTATE>/i)?.[1] || '').trim());
  const pincode = decodeXmlEntities((block.match(/<PINCODE>(.*?)<\/PINCODE>/i)?.[1] ||
                   block.match(/<LEDGERPINCODE>(.*?)<\/LEDGERPINCODE>/i)?.[1] || '').trim());
  const country = decodeXmlEntities((block.match(/<COUNTRYNAME>(.*?)<\/COUNTRYNAME>/i)?.[1] || '').trim());

  // Build street from first 1-2 address lines (excluding lines that look like city/state/pincode)
  const streetLines = lines.slice(0, 2);
  const street      = streetLines.join(', ');

  // If no dedicated city/state, try to extract from the last address line
  // Tally often puts "City, State - Pincode" or "City - Pincode" in one of the later lines
  let derivedCity    = city;
  let derivedState   = state;
  let derivedPincode = pincode;

  if (!derivedCity || !derivedState) {
    // Look through all lines for one containing a 6-digit pincode
    for (const line of lines) {
      const pinMatch = line.match(/\b(\d{6})\b/);
      if (pinMatch) {
        if (!derivedPincode) derivedPincode = pinMatch[1];
        // Try "City, State - 560001" or "City - 560001"
        const withoutPin = line.replace(pinMatch[0], '').replace(/[-,\s]+$/, '').trim();
        const parts = withoutPin.split(/[,\-]/).map(p => p.trim()).filter(Boolean);
        if (!derivedCity && parts[0])  derivedCity  = parts[0];
        if (!derivedState && parts[1]) derivedState = parts[1];
        break;
      }
    }
  }

  return {
    address: street || lines.join(', '),
    city:    derivedCity    || '',
    state:   derivedState   || '',
    pincode: derivedPincode.replace(/\D/g, '').slice(0, 6) || '',
    country: country || 'India',
  };
}

function parseLedgers(xml) {
  const ledgers = [];
  for (const m of xml.matchAll(/<LEDGER[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
    const name = decodeXmlEntities(m[1]?.trim());
    if (!name) continue;
    const block          = m[2] || '';
    const parent         = decodeXmlEntities((block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim());
    if (!parent.toLowerCase().includes('sundry')) continue;
    const guid           = extractGuid(block);
    const alterId        = extractAlterId(block);
    const gstNumber      = decodeXmlEntities((block.match(/<PARTYGSTIN>(.*?)<\/PARTYGSTIN>/i)?.[1] || 'N/A').trim());
    const openingBalance = parseFloat(block.match(/<OPENINGBALANCE>(.*?)<\/OPENINGBALANCE>/i)?.[1]) || 0;
    const email          = decodeXmlEntities((block.match(/<EMAIL>(.*?)<\/EMAIL>/i)?.[1] || '').trim());
    const phone          = decodeXmlEntities((block.match(/<LEDGERMOBILE>(.*?)<\/LEDGERMOBILE>/i)?.[1] || '').trim());
    const contactPerson  = decodeXmlEntities((block.match(/<MAILINGNAME>(.*?)<\/MAILINGNAME>/i)?.[1] || '').trim());
    const isCreditor     = parent.toLowerCase().includes('creditor');
    const addrInfo       = parseTallyAddress(block);
    ledgers.push({ name, guid, alterId, gstNumber, openingBalance, email, phone, contactPerson, isCreditor, ...addrInfo });
  }
  return ledgers;
}

/**
 * Normalise a phone number coming from Tally.
 * Tally stores numbers in many formats:
 *   "9876543210", "+91-9876543210", "091-9876543210", "98765 43210", etc.
 * Returns a clean 10-digit string, or '' if the number cannot be recovered.
 */
function normaliseTallyPhone(raw) {
  if (!raw) return '';
  // Strip all non-digit characters
  let digits = String(raw).replace(/\D/g, '');
  // Remove leading country code 91 (India) when present → leaves 10 digits
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0'))  digits = digits.slice(1);
  // Accept only if exactly 10 digits
  return digits.length === 10 ? digits : '';
}

function ledgersToOps(ledgers) {
  const ledgerOps = [], vendorOps = [], clientOps = [];
  for (const l of ledgers) {
    const { name, guid, alterId, gstNumber, openingBalance, email, phone, contactPerson, isCreditor,
            address, city, state, pincode, country } = l;
    const ledgerGroup = isCreditor ? 'Sundry Creditors' : 'Sundry Debtors';
    const ledgerCode  = `TALLY-${name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 20)}-${Date.now() % 10000}`;
    const lFilter     = guid ? { tallyGuid: guid } : { ledgerName: name };

    // Normalise phone
    const cleanPhone = normaliseTallyPhone(phone);
    const rawDigits  = phone ? String(phone).replace(/\D/g, '').slice(0, 15) : '';
    const safePhone  = cleanPhone || rawDigits || '0000000000';
    const safeEmail  = email || `${name.replace(/\s+/g, '').toLowerCase().slice(0, 30)}@tally.sync`;

    ledgerOps.push({ updateOne: {
      filter: lFilter,
      update: {
        $set: {
          ledgerGroup, gstNumber, openingBalance,
          syncedWithTally: true, lastTallySync: new Date(),
          ...(email        ? { email }                     : {}),
          ...(cleanPhone   ? { phone: cleanPhone }         : (rawDigits ? { phone: rawDigits } : {})),
          ...(address      ? { 'address.street': address } : {}),
          ...(city         ? { 'address.city':   city   }  : {}),
          ...(state        ? { 'address.state':  state  }  : {}),
          ...(pincode      ? { 'address.pincode':pincode }  : {}),
          ...(country      ? { 'address.country':country }  : {}),
          ...(guid         ? { tallyGuid:   guid }          : {}),
          ...(alterId      ? { tallyAlterId:alterId }       : {}),
        },
        $setOnInsert: { ledgerCode, ledgerName: name, contactPerson: contactPerson || name, panNumber: 'N/A', isActive: true },
      },
      upsert: true,
    }});

    if (isCreditor) {
      vendorOps.push({ updateOne: {
        filter: guid ? { tallyGuid: guid } : { companyName: name },
        update: {
          $set: {
            tallySynced: true, lastTallySync: new Date(),
            ...(safePhone !== '0000000000'                   ? { phone:   safePhone } : {}),
            ...(email                                        ? { email:   safeEmail } : {}),
            ...(contactPerson                                ? { contactPerson }      : {}),
            ...(address                                      ? { address }            : {}),
            ...(city                                         ? { city }               : {}),
            ...(state                                        ? { state }              : {}),
            ...(pincode                                      ? { pincode }            : {}),
            ...(gstNumber && gstNumber !== 'N/A'             ? { gstNumber }          : {}),
            ...(guid    ? { tallyGuid:   guid }               : {}),
            ...(alterId ? { tallyAlterId:alterId }            : {}),
          },
          $setOnInsert: {
            vendorId: `VND-TALLY-${Date.now() % 100000}`, companyName: name,
            category: 'General', contactPerson: contactPerson || name,
            phone: safePhone, email: safeEmail,
            address: address || 'Imported from Tally',
            city:    city    || 'Unknown',
            state:   state   || 'Unknown',
            pincode: pincode || '000000',
            status: 'Active',
          },
        },
        upsert: true,
      }});
    } else {
      clientOps.push({ updateOne: {
        filter: guid ? { tallyGuid: guid } : { name },
        update: {
          $set: {
            tallySynced: true, lastTallySync: new Date(),
            ...(safePhone !== '0000000000'                   ? { phone:   safePhone } : {}),
            ...(email                                        ? { email:   safeEmail } : {}),
            ...(contactPerson                                ? { contact: contactPerson } : {}),
            ...(address                                      ? { address }            : {}),
            ...(city                                         ? { city }               : {}),
            ...(gstNumber && gstNumber !== 'N/A'             ? { gstNumber }          : {}),
            ...(guid    ? { tallyGuid:   guid }               : {}),
            ...(alterId ? { tallyAlterId:alterId }            : {}),
          },
          $setOnInsert: {
            clientId: `CLT-TALLY-${Date.now() % 100000}`, name,
            contact: contactPerson || name, phone: safePhone, email: safeEmail,
            city:    city    || 'Unknown',
            category: 'Trading', status: 'Active',
          },
        },
        upsert: true,
      }});
    }
  }
  return { ledgerOps, vendorOps, clientOps };
}

function parseVouchers(xml, voucherType) {
  const vouchers = [];
  // Match all VOUCHER blocks — Tally uses both VCHTYPE attribute and inner tag
  const typePattern = new RegExp(`<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>`, 'gi');
  for (const m of xml.matchAll(typePattern)) {
    const block = m[1];
    // Confirm voucher type
    const vt = (block.match(/<VOUCHERTYPENAME>(.*?)<\/VOUCHERTYPENAME>/i)?.[1] || '').trim();
    if (voucherType && vt.toLowerCase() !== voucherType.toLowerCase()) continue;

    const guid       = extractGuid(block);
    const alterId    = extractAlterId(block);
    const voucherNo  = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1] || '').trim();
    const partyName  = (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1] || '').trim();
    const rawDate    = (block.match(/<DATE>(.*?)<\/DATE>/i)?.[1] || '').trim();
    const amount     = Math.abs(parseFloat(block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1]) || 0);
    const narration  = (block.match(/<NARRATION>(.*?)<\/NARRATION>/i)?.[1] || '').trim();
    const vDate      = rawDate.length === 8
      ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`)
      : new Date();

    const ledgerEntries = [];
    for (const le of block.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi)) {
      const lb      = le[1];
      const lName   = (lb.match(/<LEDGERNAME>(.*?)<\/LEDGERNAME>/i)?.[1] || '').trim();
      const lAmt    = parseFloat(lb.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1]) || 0;
      const isDmd   = (lb.match(/<ISDEEMEDPOSITIVE>(.*?)<\/ISDEEMEDPOSITIVE>/i)?.[1] || 'No').trim() === 'Yes';
      if (lName) ledgerEntries.push({ ledgerName: lName, amount: lAmt, isDeemed: isDmd });
    }

    vouchers.push({ guid, alterId, voucherNo, voucherType: vt || voucherType, partyName, amount, narration, vDate, ledgerEntries });
  }
  return vouchers;
}

function vouchersToInvoiceOps(vouchers) {
  return vouchers.map(v => {
    const filter = v.guid ? { tallyGuid: v.guid } : { invoiceNo: v.voucherNo };
    return { updateOne: {
      filter,
      update: {
        $set: {
          partyName: v.partyName, grandTotal: v.amount,
          ...(v.guid     ? { tallyGuid: v.guid }         : {}),
          ...(v.alterId  ? { tallyAlterId: v.alterId }   : {}),
        },
        $setOnInsert: {
          invoiceNo: v.voucherNo, partyName: v.partyName, invoiceDate: v.vDate,
          grandTotal: v.amount, source: 'manual', status: 'Sent', invoiceType: 'single', items: [],
        },
      },
      upsert: true,
    }};
  });
}

function vouchersToTallyVoucherOps(vouchers) {
  return vouchers.map(v => {
    const filter = v.guid
      ? { tallyGuid: v.guid }
      : (v.voucherNo ? { voucherNumber: v.voucherNo, voucherType: v.voucherType } : null);
    if (!filter) return null;
    return { updateOne: {
      filter,
      update: {
        $set: {
          partyName: v.partyName, amount: v.amount, narration: v.narration,
          voucherDate: v.vDate, ledgerEntries: v.ledgerEntries,
          source: 'Tally', syncedAt: new Date(),
          ...(v.guid    ? { tallyGuid: v.guid }         : {}),
          ...(v.alterId ? { tallyAlterId: v.alterId }   : {}),
        },
        $setOnInsert: {
          voucherType: v.voucherType,
          voucherNumber: v.voucherNo || `TALLY-${Date.now()}`,
        },
      },
      upsert: true,
    }};
  }).filter(Boolean);
}

// ─── DB WRITE HELPERS ─────────────────────────────────────────────────────────

async function writeItemsToDb(ops) {
  if (!ops.length) return 0;
  const r = await ItemMaster.bulkWrite(ops, { ordered: false });
  return (r.upsertedCount || 0) + (r.modifiedCount || 0);
}

async function writeLedgersToDb({ ledgerOps, vendorOps, clientOps }) {
  const results = await Promise.all([
    ledgerOps.length ? AccountsLedger.bulkWrite(ledgerOps, { ordered: false }).catch(e => { ERR('AccountsLedger bulkWrite:', e.message); return null; }) : null,
    vendorOps.length ? Vendor.bulkWrite(vendorOps, { ordered: false }).catch(e => { ERR('Vendor bulkWrite:', e.message); return null; }) : null,
    clientOps.length ? Client.bulkWrite(clientOps, { ordered: false }).catch(e => { ERR('Client bulkWrite:', e.message); return null; }) : null,
  ]);
  const total = results.reduce((s, r) => s + (r ? (r.upsertedCount || 0) + (r.modifiedCount || 0) : 0), 0);
  return total;
}

async function writeInvoiceVouchersToDb(ops) {
  if (!ops.length) return 0;
  const r = await Invoice.bulkWrite(ops, { ordered: false });
  return (r.upsertedCount || 0) + (r.modifiedCount || 0);
}

async function writeTallyVouchersToDb(ops) {
  if (!ops.length) return 0;
  const r = await TallyVoucher.bulkWrite(ops, { ordered: false });
  return (r.upsertedCount || 0) + (r.modifiedCount || 0);
}

// ─── CORE FETCH FUNCTION (single request) ────────────────────────────────────
// Performs one Tally request (full or chunked) and writes results to DB.
// Returns { records, complete }

async function fetchAndSave(cfg, entityType, fromDate, toDate) {
  const reportMap = {
    Items:   { report: 'List of Stock Items', tag: '<STOCKITEM', fallbackReports: ['Stock Summary'] },
    Ledgers: { report: 'List of Ledgers',     tag: '<LEDGER',    fallbackReports: ['Ledger', 'List of Accounts'] },
    Purchase:{ report: 'Day Book',            tag: '<VOUCHER',   voucherType: 'Purchase' },
    Sales:   { report: 'Day Book',            tag: '<VOUCHER',   voucherType: 'Sales' },
    Payment: { report: 'Day Book',            tag: '<VOUCHER',   voucherType: 'Payment' },
    Receipt: { report: 'Day Book',            tag: '<VOUCHER',   voucherType: 'Receipt' },
    Journal: { report: 'Day Book',            tag: '<VOUCHER',   voucherType: 'Journal' },
    Contra:  { report: 'Day Book',            tag: '<VOUCHER',   voucherType: 'Contra'  },
    Vouchers:{ report: 'Day Book',            tag: '<VOUCHER',   voucherType: null },
  };

  const meta = reportMap[entityType];
  if (!meta) throw new Error(`Unknown entityType: ${entityType}`);

  const extraVars = meta.voucherType
    ? `<VOUCHERTYPENAME>${meta.voucherType}</VOUCHERTYPENAME>`
    : '';

  let xml;
  if (fromDate && toDate) {
    xml = buildChunkFetchXml(cfg, meta.report, fromDate, toDate, extraVars);
  } else {
    xml = buildFullFetchXml(cfg, meta.report, extraVars);
  }

  let resp = await postXmlWithRetry(cfg, xml, fromDate ? CHUNK_TIMEOUT : FULL_FETCH_TIMEOUT, MAX_CHUNK_RETRIES);

  // For Items — try fallback reports if primary returned nothing
  if (entityType === 'Items' && (!resp || !resp.includes(meta.tag))) {
    for (const fallback of (meta.fallbackReports || [])) {
      LOG(`Primary report empty, trying fallback: "${fallback}"`);
      const fallbackXml = fromDate
        ? buildChunkFetchXml(cfg, fallback, fromDate, toDate, extraVars)
        : buildFullFetchXml(cfg, fallback, extraVars);
      resp = await postXmlWithRetry(cfg, fallbackXml, CHUNK_TIMEOUT, 2).catch(() => '');
      if (resp && resp.includes(meta.tag)) break;
    }
  }

  if (!resp || !resp.includes(meta.tag)) {
    LOG(`No ${entityType} data in response`);
    return { records: 0, complete: true }; // empty but valid
  }

  const complete = isResponseComplete(resp);
  if (!complete) {
    ERR(`Response for ${entityType} appears truncated (${resp.length} bytes)`);
  }

  let records = 0;
  if (entityType === 'Items') {
    const parsed = parseStockItems(resp);
    const ops    = itemsToOps(parsed);
    records = await writeItemsToDb(ops);
    LOG(`  Items written: ${records}`);

  } else if (entityType === 'Ledgers') {
    const parsed = parseLedgers(resp);
    const ops    = ledgersToOps(parsed);
    records = await writeLedgersToDb(ops);
    LOG(`  Ledgers written: ${records}`);

  } else if (entityType === 'Purchase' || entityType === 'Sales') {
    const parsed = parseVouchers(resp, meta.voucherType);
    const ops    = vouchersToInvoiceOps(parsed);
    records = await writeInvoiceVouchersToDb(ops);
    LOG(`  ${entityType} vouchers written: ${records}`);

  } else if (entityType === 'Payment' || entityType === 'Receipt') {
    const parsed = parseVouchers(resp, meta.voucherType);
    const ops    = vouchersToTallyVoucherOps(parsed);
    records = await writeTallyVouchersToDb(ops);
    LOG(`  ${entityType} vouchers written: ${records}`);

  } else if (entityType === 'Journal' || entityType === 'Contra') {
    // Journal & Contra → stored in TallyVoucher (same as Payment/Receipt)
    const parsed = parseVouchers(resp, meta.voucherType);
    const ops    = vouchersToTallyVoucherOps(parsed);
    records = await writeTallyVouchersToDb(ops);
    LOG(`  ${entityType} vouchers written: ${records}`);

  } else if (entityType === 'Vouchers') {
    // All voucher types together
    const parsed   = parseVouchers(resp, null);
    const salesPur = parsed.filter(v => ['Sales','Purchase'].includes(v.voucherType));
    const payRec   = parsed.filter(v => ['Payment','Receipt'].includes(v.voucherType));
    const r1 = await writeInvoiceVouchersToDb(vouchersToInvoiceOps(salesPur));
    const r2 = await writeTallyVouchersToDb(vouchersToTallyVoucherOps(payRec));
    records = r1 + r2;
  }

  return { records, complete };
}

// ─── FULL FETCH ATTEMPT ───────────────────────────────────────────────────────
// Tries to pull all data in a single request. Returns success/failure + record count.

async function tryFullFetch(cfg, state, entityType) {
  LOG(`[${entityType}] Attempting FULL FETCH...`);
  try {
    const { records, complete } = await fetchAndSave(cfg, entityType, null, null);

    if (!complete) {
      LOG(`[${entityType}] Full fetch incomplete — switching to chunk sync`);
      return { ok: false, records, reason: 'truncated' };
    }

    LOG(`[${entityType}] Full fetch SUCCESS — ${records} records`);
    state.usedFullFetch   = true;
    state.syncStatus      = 'completed';
    state.totalRecords    = records;
    state.lastSuccessAt   = new Date();
    state.lastSyncedDate  = new Date();
    state.chunks          = [];
    state.lastCompletedChunkIndex = -1;
    await state.save();

    return { ok: true, records };
  } catch (err) {
    ERR(`[${entityType}] Full fetch failed: ${err.message}`);
    return { ok: false, records: 0, reason: err.message };
  }
}

// ─── CHUNK SYNC ENGINE ────────────────────────────────────────────────────────

async function runChunkSync(cfg, state, entityType, fromDate, toDate) {
  LOG(`[${entityType}] Starting CHUNK SYNC from ${td(fromDate)} to ${td(toDate)}`);

  // Build chunks only if not already built for this window
  // (allows resume after crash)
  const sameWindow =
    state.syncWindowStart?.toDateString() === fromDate.toDateString() &&
    state.syncWindowEnd?.toDateString()   === toDate.toDateString() &&
    state.chunks.length > 0;

  if (!sameWindow) {
    LOG(`[${entityType}] Building new chunk plan`);
    state.chunks                  = buildChunks(fromDate, toDate);
    state.lastCompletedChunkIndex = -1;
    state.syncWindowStart         = fromDate;
    state.syncWindowEnd           = toDate;
    state.totalRecords            = 0;
    await state.save();
  } else {
    LOG(`[${entityType}] Resuming existing chunk plan from chunk ${state.lastCompletedChunkIndex + 1}`);
  }

  let totalRecords = state.totalRecords || 0;
  let failedChunks = 0;

  for (let i = state.lastCompletedChunkIndex + 1; i < state.chunks.length; i++) {
    const chunk = state.chunks[i];
    if (chunk.status === 'success') {
      LOG(`[${entityType}] Chunk ${i} already done — skipping`);
      totalRecords += chunk.records || 0;
      continue;
    }

    LOG(`[${entityType}] Chunk ${i + 1}/${state.chunks.length}: ${td(chunk.fromDate)} → ${td(chunk.toDate)}`);
    chunk.attempts = (chunk.attempts || 0) + 1;
    chunk.status   = 'pending';

    let chunkOk = false;
    let lastChunkErr = '';
    let chunkRecords = 0;

    // Retry loop per chunk
    for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
      try {
        const { records, complete } = await fetchAndSave(cfg, entityType, chunk.fromDate, chunk.toDate);
        chunkRecords = records;
        chunk.records = records;

        if (!complete) {
          // Sub-chunk: split this chunk further in half if possible
          const halfDays = Math.ceil(CHUNK_DAYS / 2);
          if (halfDays >= 3) {
            LOG(`[${entityType}] Chunk ${i} truncated — splitting into ${halfDays}-day sub-chunks`);
            const subChunks = buildChunks(chunk.fromDate, chunk.toDate, halfDays);
            let subRecords = 0;
            let subAllOk = true;
            for (const sc of subChunks) {
              try {
                const sr = await fetchAndSave(cfg, entityType, sc.fromDate, sc.toDate);
                subRecords += sr.records;
              } catch (scErr) {
                ERR(`Sub-chunk failed: ${scErr.message}`);
                subAllOk = false;
              }
            }
            chunkRecords  = subRecords;
            chunk.records = subRecords;
            chunkOk       = subAllOk;
          } else {
            chunkOk = true; // Accept partial at this granularity
          }
        } else {
          chunkOk = true;
        }

        if (chunkOk) break;
      } catch (err) {
        lastChunkErr = err.message;
        ERR(`[${entityType}] Chunk ${i} attempt ${attempt + 1} failed: ${err.message}`);
        if (attempt < MAX_CHUNK_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        }
      }
    }

    if (chunkOk) {
      chunk.status          = 'success';
      chunk.completedAt     = new Date();
      chunk.lastError       = '';
      totalRecords          += chunkRecords;
      state.lastCompletedChunkIndex = i;
      state.totalRecords    = totalRecords;
      LOG(`[${entityType}] Chunk ${i + 1} OK — ${chunkRecords} records`);
    } else {
      chunk.status    = 'failed';
      chunk.lastError = lastChunkErr;
      failedChunks++;
      ERR(`[${entityType}] Chunk ${i + 1} FAILED after ${MAX_CHUNK_RETRIES} attempts: ${lastChunkErr}`);
    }

    // Persist progress after every chunk (so crashes can resume)
    // Use markModified because chunks is a nested array
    state.markModified('chunks');
    await state.save();
  }

  // Final status
  const allDone     = state.chunks.every(c => c.status === 'success' || c.status === 'failed');
  const anyFailed   = failedChunks > 0;
  state.syncStatus  = allDone ? (anyFailed ? 'partial' : 'completed') : 'running';
  state.usedFullFetch  = false;
  state.totalRecords   = totalRecords;
  if (!anyFailed) {
    state.lastSuccessAt  = new Date();
    state.lastSyncedDate = toDate;
  }
  await state.save();

  LOG(`[${entityType}] Chunk sync done — ${totalRecords} records, ${failedChunks} failed chunks`);
  return {
    ok: !anyFailed || totalRecords > 0,
    records: totalRecords,
    failedChunks,
    error: anyFailed ? `${failedChunks} chunk(s) failed` : undefined,
  };
}

// ─── MAIN PULL ORCHESTRATOR ───────────────────────────────────────────────────
/**
 * pullEntityFromTally(entityType, options)
 *
 * entityType: 'Items' | 'Ledgers' | 'Purchase' | 'Sales' | 'Payment' | 'Receipt'
 * options.forceChunk   — skip full-fetch attempt, go straight to chunk sync
 * options.forceRefresh — ignore lastSyncedDate, re-pull everything from companyStartDate
 * options.triggeredBy  — user ObjectId for log
 * options.startDate    — override sync window start (default: company start or 2 years ago)
 * options.endDate      — override sync window end (default: today)
 *
 * Strategy:
 *   1. If lastSyncedDate exists and !forceRefresh → incremental (lastSyncedDate → today)
 *   2. Try FULL FETCH (no date filter) unless forceChunk
 *   3. If full fetch incomplete → CHUNK SYNC
 */
export async function pullEntityFromTally(entityType, options = {}) {
  const start   = Date.now();
  const syncId  = `PULL-${entityType.toUpperCase()}-${Date.now()}`;
  const logType = entityType === 'Items' ? 'Item Master' : entityType;
  LOG(`=== pullEntityFromTally [${entityType}] START ===`);

  let state;
  try {
    const cfg = await getCfg();
    state     = await getOrCreateState(entityType);

    // Mark as running
    state.syncStatus    = 'running';
    state.syncStartedAt = new Date();
    await state.save();

    // Determine date window for chunk-sync fallback
    const today     = new Date();
    const endDate   = options.endDate   ? new Date(options.endDate)   : today;
    let   startDate = options.startDate ? new Date(options.startDate) : null;

    if (!startDate) {
      if (state.lastSyncedDate && !options.forceRefresh) {
        // Incremental: start day after last successful sync
        startDate = new Date(state.lastSyncedDate);
        startDate.setDate(startDate.getDate() + 1);
        LOG(`[${entityType}] Incremental sync from ${td(startDate)}`);
      } else {
        // Default to 2 years back for first-time sync
        startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 2);
        LOG(`[${entityType}] Full history sync from ${td(startDate)}`);
      }
    }

    // For Ledgers/Items: no date filter makes sense — always try full fetch
    const isTimeless = entityType === 'Items' || entityType === 'Ledgers';

    let result;
    if (!options.forceChunk) {
      result = await tryFullFetch(cfg, state, entityType);
      if (result.ok) {
        await writeSyncLog({ syncId, type: logType, direction: 'Tally → ERP', status: 'Success',
          duration: `${((Date.now() - start) / 1000).toFixed(1)}s`, records: result.records });
        await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date() }, { upsert: true });
        return { ok: true, records: result.records, usedChunks: false };
      }
      LOG(`[${entityType}] Full fetch not viable (${result.reason}) — falling back to chunk sync`);
    }

    // For timeless entities (Items/Ledgers), a single request covering all time is
    // the correct approach; if that failed, try once more with a very wide date window
    if (isTimeless) {
      const wideStart = new Date();
      wideStart.setFullYear(wideStart.getFullYear() - 5);
      result = await runChunkSync(cfg, state, entityType, wideStart, endDate);
    } else {
      result = await runChunkSync(cfg, state, entityType, startDate, endDate);
    }

    const status   = result.ok ? (result.failedChunks > 0 ? 'Partial' : 'Success') : 'Failed';
    const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeSyncLog({ syncId, type: logType, direction: 'Tally → ERP', status, duration,
      error: result.error, records: result.records });
    await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date() }, { upsert: true });

    LOG(`=== pullEntityFromTally [${entityType}] END — ok:${result.ok} records:${result.records} ===`);
    return { ok: result.ok, records: result.records, usedChunks: true, failedChunks: result.failedChunks };

  } catch (err) {
    ERR(`pullEntityFromTally [${entityType}] FATAL:`, err.message);
    if (state) {
      state.syncStatus = 'failed';
      await state.save().catch(() => {});
    }
    const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    await writeSyncLog({ syncId, type: logType, direction: 'Tally → ERP', status: 'Failed',
      duration, error: err.message, records: 0 });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── CONVENIENCE EXPORTS ──────────────────────────────────────────────────────

export const pullItemsRobust   = (opts) => pullEntityFromTally('Items',   opts);
export const pullLedgersRobust = (opts) => pullEntityFromTally('Ledgers', opts);
export const pullPurchaseRobust= (opts) => pullEntityFromTally('Purchase',opts);
export const pullSalesRobust   = (opts) => pullEntityFromTally('Sales',   opts);
export const pullPaymentRobust = (opts) => pullEntityFromTally('Payment', opts);
export const pullReceiptRobust = (opts) => pullEntityFromTally('Receipt', opts);

/**
 * runRobustFullPull — pulls ALL entity types in order with full/chunk fallback logic.
 * Drop-in replacement for the pull phase of runFullSync in tallyService.js
 */
export async function runRobustFullPull(options = {}) {
  LOG('======= runRobustFullPull START =======');
  const results = [];
  const entities = ['Items', 'Ledgers', 'Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra'];

  for (const entity of entities) {
    const r = await pullEntityFromTally(entity, options);
    results.push({ entity, ...r });
    LOG(`  ${entity}: ok=${r.ok} records=${r.records} usedChunks=${r.usedChunks || false}`);
  }

  const totalRecords = results.reduce((s, r) => s + (r.records || 0), 0);
  const failed       = results.filter(r => !r.ok);
  const ok           = failed.length === 0;
  LOG(`======= runRobustFullPull END — ok:${ok} total:${totalRecords} =======`);
  return { ok, records: totalRecords, results, error: failed.map(r => `${r.entity}: ${r.error}`).join('; ') || undefined };
}

/**
 * getSyncStateStatus — returns current state for all entity types (for API/dashboard)
 */
export async function getSyncStateStatus() {
  const states = await TallySyncState.find({}).lean();
  return states.map(s => ({
    entityType            : s.entityType,
    syncStatus            : s.syncStatus,
    lastSyncedDate        : s.lastSyncedDate,
    lastSuccessAt         : s.lastSuccessAt,
    totalRecords          : s.totalRecords,
    usedFullFetch         : s.usedFullFetch,
    totalChunks           : s.chunks?.length || 0,
    completedChunks       : s.chunks?.filter(c => c.status === 'success').length || 0,
    failedChunks          : s.chunks?.filter(c => c.status === 'failed').length || 0,
    lastCompletedChunkIndex: s.lastCompletedChunkIndex,
    syncWindowStart       : s.syncWindowStart,
    syncWindowEnd         : s.syncWindowEnd,
    syncStartedAt         : s.syncStartedAt,
  }));
}

/**
 * resetSyncState — resets the sync state for an entity so next run starts fresh.
 * Useful if the DB was wiped or sync state is corrupted.
 */
export async function resetSyncState(entityType) {
  await TallySyncState.findOneAndUpdate(
    { entityType },
    {
      $set: {
        syncStatus: 'idle', lastSyncedDate: null, totalRecords: 0,
        chunks: [], lastCompletedChunkIndex: -1,
        syncWindowStart: null, syncWindowEnd: null, lastSuccessAt: null,
      },
    },
    { upsert: true }
  );
  LOG(`[${entityType}] Sync state reset`);
}
