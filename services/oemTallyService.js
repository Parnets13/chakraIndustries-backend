/**
 * oemTallyService.js
 *
 * OEM-specific Tally sync helpers.
 * All communication with Tally uses XML over HTTP POST (the only protocol
 * Tally Prime's built-in HTTP server understands).
 *
 * Previous version incorrectly used REST/JSON endpoints like
 *   POST /vouchers/create   ← does NOT exist in Tally Prime
 *   POST /ledgers/update    ← does NOT exist in Tally Prime
 *
 * Fixed: all requests now POST XML to the root endpoint ( / ) which is
 * the only endpoint Tally exposes.
 */

import OEMOrder     from '../models/OEMOrder.js';
import OEMInvoice   from '../models/OEMInvoice.js';
import OEMBrand     from '../models/OEMBrand.js';
import TallySyncLog from '../models/TallySyncLog.js';
import TallyConfig  from '../models/TallyConfig.js';
import axios        from 'axios';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve Tally base URL from DB config (mirrors tallyService.js logic). */
async function getTallyBaseUrl() {
  const cfg  = await TallyConfig.findOne();
  if (!cfg) return 'http://localhost:9000';
  const local = (cfg.tallyLocalUrl || '').trim();
  const port  = cfg.port || '9000';
  if (!local) return `http://localhost:${port}`;
  if (local.startsWith('https://') || local.match(/:\d+$/)) return local.replace(/\/$/, '');
  return `${local.replace(/\/$/, '')}:${port}`;
}

/** Escape a string for safe embedding in XML. */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Format a JS Date to YYYYMMDD as required by Tally. */
function fmtDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

/**
 * POST XML to Tally and return the raw response string.
 * Returns '' on network error (logged).
 */
async function postToTally(xml, label = 'request') {
  const url = await getTallyBaseUrl();
  try {
    const resp = await axios({
      method       : 'POST',
      url,
      data         : xml,
      headers      : { 'Content-Type': 'text/xml', Accept: '*/*' },
      timeout      : 15_000,
      responseType : 'text',
      validateStatus: () => true,
    });
    const body = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    console.log(`[OEMTally] ${label} → HTTP ${resp.status} (${body.length} bytes)`);
    return body;
  } catch (err) {
    console.error(`[OEMTally] ${label} network error:`, err.message);
    return '';
  }
}

/** Parse the LINEERROR / CREATED / ALTERED counts from a Tally import response. */
function parseImportResult(xml) {
  const errors  = parseInt((xml.match(/<LINEERROR>(\d+)<\/LINEERROR>/i)   || [])[1] || '0', 10);
  const created = parseInt((xml.match(/<CREATED>(\d+)<\/CREATED>/i)       || [])[1] || '0', 10);
  const altered = parseInt((xml.match(/<ALTERED>(\d+)<\/ALTERED>/i)       || [])[1] || '0', 10);
  return { errors, created, altered, ok: errors === 0 };
}

// ── Build XML for a Journal voucher ─────────────────────────────────────────

/**
 * Builds a Tally-compatible XML import envelope for a Journal voucher.
 *
 * @param {object} opts
 * @param {string}   opts.voucherDate  - YYYYMMDD or JS Date
 * @param {string}   opts.reference    - voucher reference / number
 * @param {string}   opts.narration    - free-text narration
 * @param {string}   opts.company      - Tally company name
 * @param {Array<{ledgerName:string, amount:number, isDebit:boolean}>} opts.entries
 */
function buildJournalXml({ voucherDate, reference, narration, company, entries }) {
  const date    = typeof voucherDate === 'string' && voucherDate.length === 8
    ? voucherDate
    : fmtDate(voucherDate || new Date());

  const ledgerLines = entries.map(e => {
    // Tally sign convention: positive = debit, negative = credit
    const amt = e.isDebit ? Math.abs(e.amount) : -Math.abs(e.amount);
    return `
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>${e.isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
        <AMOUNT>${amt.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`;
  }).join('');

  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Journal" ACTION="Create">
            <DATE>${date}</DATE>
            <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${esc(reference)}</VOUCHERNUMBER>
            <NARRATION>${esc(narration)}</NARRATION>
            ${ledgerLines}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/** Build XML for a Sales or Payment voucher. */
function buildVoucherXml({ voucherType, voucherDate, reference, narration, company, entries }) {
  const date = typeof voucherDate === 'string' && voucherDate.length === 8
    ? voucherDate
    : fmtDate(voucherDate || new Date());

  const ledgerLines = entries.map(e => {
    const amt = e.isDebit ? Math.abs(e.amount) : -Math.abs(e.amount);
    return `
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>${e.isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
        <AMOUNT>${amt.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`;
  }).join('');

  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${esc(voucherType)}" ACTION="Create">
            <DATE>${date}</DATE>
            <VOUCHERTYPENAME>${esc(voucherType)}</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${esc(reference)}</VOUCHERNUMBER>
            <NARRATION>${esc(narration)}</NARRATION>
            ${ledgerLines}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/** Get company name from TallyConfig (falls back to env or default). */
async function getCompany() {
  const cfg = await TallyConfig.findOne();
  return (cfg?.companyName || process.env.TALLY_COMPANY || 'SRI CHAKRA INDUSTRIES').trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sync OEM Order to Tally as a Journal voucher (manufacturing entry).
 */
export const syncOEMOrderToTally = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId)
      .populate('brandOrderId')
      .populate('bomId');

    if (!oemOrder)              return { success: false, message: 'OEM order not found' };
    if (oemOrder.tallyStatus === 'Synced') return { success: false, message: 'Already synced to Tally' };

    const company   = await getCompany();
    const totalCost = (oemOrder.actualCost || oemOrder.estimatedCost || 0)
                    + (oemOrder.overheadCost || 0);

    const xml = buildJournalXml({
      voucherDate : oemOrder.completedAt || new Date(),
      reference   : oemOrder.oemOrderId,
      narration   : `Manufacturing - ${oemOrder.product} for ${oemOrder.brandOrderId?.brandName || 'Brand'}`,
      company,
      entries: [
        { ledgerName: 'Finished Goods',        amount: oemOrder.actualCost || oemOrder.estimatedCost || 0, isDebit: true  },
        { ledgerName: 'Manufacturing Overhead', amount: oemOrder.overheadCost || 0,                        isDebit: true  },
        { ledgerName: 'Raw Materials',          amount: oemOrder.materialCost || 0,                        isDebit: false },
        { ledgerName: 'Labour Cost',            amount: oemOrder.laborCost    || 0,                        isDebit: false },
        // Balancing entry if costs don't balance
        ...(totalCost > 0 && !oemOrder.materialCost && !oemOrder.laborCost
          ? [{ ledgerName: 'Manufacturing Overhead', amount: totalCost, isDebit: false }]
          : []),
      ].filter(e => e.amount > 0),
    });

    const response = await postToTally(xml, `OEM Order ${oemOrder.oemOrderId}`);
    const result   = parseImportResult(response);

    if (!result.ok) {
      throw new Error(`Tally import reported ${result.errors} error(s)`);
    }

    oemOrder.tallyStatus = 'Synced';
    oemOrder.tallyReference = oemOrder.oemOrderId;
    await oemOrder.save();

    await TallySyncLog.create({
      entityType: 'OEMOrder',
      entityId  : oemOrder._id,
      entityNumber: oemOrder.oemOrderId,
      status    : 'Success',
      syncedAt  : new Date(),
    });

    console.log(`✅ OEM Order synced to Tally: ${oemOrder.oemOrderId}`);
    return { success: true, message: 'OEM order synced to Tally', data: oemOrder };

  } catch (error) {
    console.error('❌ OEM Tally sync failed:', error.message);
    await TallySyncLog.create({
      entityType  : 'OEMOrder',
      entityId    : oemOrderId,
      status      : 'Failed',
      errorMessage: error.message,
      syncedAt    : new Date(),
    });
    return { success: false, message: error.message };
  }
};

/**
 * Sync OEM Invoice to Tally as a Sales voucher.
 */
export const syncOEMInvoiceToTally = async (invoiceId) => {
  try {
    const invoice = await OEMInvoice.findById(invoiceId)
      .populate('oemOrderId')
      .populate('brandOrderId');

    if (!invoice)                      return { success: false, message: 'Invoice not found' };
    if (invoice.tallyStatus === 'Synced') return { success: false, message: 'Already synced to Tally' };

    const company = await getCompany();
    const xml = buildVoucherXml({
      voucherType : 'Sales',
      voucherDate : invoice.invoiceDate,
      reference   : invoice.invoiceNumber,
      narration   : `OEM Manufacturing Invoice - ${invoice.product || ''}`,
      company,
      entries: [
        { ledgerName: 'Accounts Receivable', amount: invoice.totalAmount, isDebit: true  },
        { ledgerName: 'Sales Revenue',        amount: invoice.subtotal  || invoice.totalAmount, isDebit: false },
        ...(invoice.taxAmount > 0 ? [{ ledgerName: 'GST Output', amount: invoice.taxAmount, isDebit: false }] : []),
      ].filter(e => e.amount > 0),
    });

    const response = await postToTally(xml, `OEM Invoice ${invoice.invoiceNumber}`);
    const result   = parseImportResult(response);

    if (!result.ok) {
      throw new Error(`Tally import reported ${result.errors} error(s)`);
    }

    invoice.tallyStatus = 'Synced';
    await invoice.save();

    await TallySyncLog.create({
      entityType  : 'OEMInvoice',
      entityId    : invoice._id,
      entityNumber: invoice.invoiceNumber,
      status      : 'Success',
      syncedAt    : new Date(),
    });

    console.log(`✅ OEM Invoice synced to Tally: ${invoice.invoiceNumber}`);
    return { success: true, message: 'Invoice synced to Tally', data: invoice };

  } catch (error) {
    console.error('❌ Invoice Tally sync failed:', error.message);
    await TallySyncLog.create({
      entityType  : 'OEMInvoice',
      entityId    : invoiceId,
      status      : 'Failed',
      errorMessage: error.message,
      syncedAt    : new Date(),
    });
    return { success: false, message: error.message };
  }
};

/**
 * Update Brand Ledger in Tally (creates a Journal entry).
 * NOTE: Tally has no REST "update ledger" endpoint.
 * This creates a voucher entry that credits/debits the brand ledger.
 */
export const updateBrandLedgerInTally = async (brandId, amount, type = 'revenue') => {
  try {
    const brand = await OEMBrand.findById(brandId);
    if (!brand) return { success: false, message: 'Brand not found' };

    const company = await getCompany();
    const isRevenue = type === 'revenue';

    const xml = buildJournalXml({
      voucherDate : new Date(),
      reference   : `BRAND-${brand.name.slice(0, 20).replace(/\s+/g, '-')}-${Date.now()}`,
      narration   : `${isRevenue ? 'Revenue' : 'Charge'} for ${brand.name}`,
      company,
      entries: [
        { ledgerName: isRevenue ? 'Accounts Receivable'  : `Brand - ${brand.name}`, amount, isDebit: true  },
        { ledgerName: isRevenue ? `Brand - ${brand.name}` : 'Expenses',              amount, isDebit: false },
      ],
    });

    const response = await postToTally(xml, `Brand ledger ${brand.name}`);
    const result   = parseImportResult(response);

    if (!result.ok) throw new Error(`Tally import reported ${result.errors} error(s)`);

    console.log(`✅ Brand ledger updated in Tally: ${brand.name}`);
    return { success: true, message: 'Brand ledger updated' };

  } catch (error) {
    console.error('❌ Brand ledger update failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Sync Payment to Tally as a Payment voucher.
 */
export const syncPaymentToTally = async (invoiceId, paymentAmount, paymentMethod) => {
  try {
    const invoice = await OEMInvoice.findById(invoiceId);
    if (!invoice) return { success: false, message: 'Invoice not found' };

    const company  = await getCompany();
    const bankLedger = paymentMethod === 'Cash' ? 'Cash' : 'Bank Account';

    const xml = buildVoucherXml({
      voucherType : 'Payment',
      voucherDate : new Date(),
      reference   : `PAY-${invoice.invoiceNumber}`,
      narration   : `Payment for OEM Invoice ${invoice.invoiceNumber}`,
      company,
      entries: [
        { ledgerName: 'Accounts Receivable', amount: paymentAmount, isDebit: true  },
        { ledgerName: bankLedger,             amount: paymentAmount, isDebit: false },
      ],
    });

    const response = await postToTally(xml, `Payment for ${invoice.invoiceNumber}`);
    const result   = parseImportResult(response);

    if (!result.ok) throw new Error(`Tally import reported ${result.errors} error(s)`);

    invoice.amountPaid     = (invoice.amountPaid || 0) + paymentAmount;
    invoice.paymentDate    = new Date();
    invoice.paymentMethod  = paymentMethod;
    invoice.paymentStatus  = invoice.amountPaid >= invoice.totalAmount ? 'Paid' : 'Partial';
    await invoice.save();

    console.log(`✅ Payment synced to Tally: ${invoice.invoiceNumber}`);
    return { success: true, message: 'Payment synced to Tally', data: invoice };

  } catch (error) {
    console.error('❌ Payment sync failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Get OEM Tally Sync Status for an order.
 */
export const getOEMTallySyncStatus = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId);
    if (!oemOrder) return { success: false, message: 'OEM order not found' };

    const syncLogs = await TallySyncLog.find({ entityId: oemOrderId })
      .sort({ syncedAt: -1 })
      .limit(10);

    return {
      success: true,
      data: {
        oemOrder: {
          oemOrderId      : oemOrder.oemOrderId,
          tallyStatus     : oemOrder.tallyStatus,
          tallyDocumentId : oemOrder.tallyDocumentId,
          tallyReference  : oemOrder.tallyReference,
          tallyError      : oemOrder.tallyError,
        },
        syncHistory: syncLogs,
      },
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

/**
 * Retry a failed Tally sync for an OEM Order.
 */
export const retryFailedTallySync = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId);
    if (!oemOrder)                       return { success: false, message: 'OEM order not found' };
    if (oemOrder.tallyStatus === 'Synced') return { success: false, message: 'Already synced' };

    oemOrder.tallyStatus = 'Pending';
    oemOrder.tallyError  = null;
    await oemOrder.save();

    return await syncOEMOrderToTally(oemOrderId);
  } catch (error) {
    return { success: false, message: error.message };
  }
};
