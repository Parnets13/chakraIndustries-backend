// Test script with the fix!
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from '../config/database.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import TallyConfig from '../models/TallyConfig.js';

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function staticVars(cfg, extra = '') {
  const co = (cfg.companyName || '').trim().toUpperCase();
  return `<STATICVARIABLES>${co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : ''}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST>${extra}</STATICVARIABLES>`;
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function tallyDate(d) {
  const dt = new Date(d);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function runTest() {
  await connectDB();
  const cfg = await TallyConfig.findOne().sort({ _id: 1 });
  console.log('Got config:', { useConnector: cfg.useConnector, connectorId: cfg.connectorId, tallyLocalUrl: cfg.tallyLocalUrl });

  // Create a test invoice just like the one in the error log!
  const testInvoice = {
    invoiceNo: 'TEST-BIW01', // Unique voucher number
    partyName: 'BI Worldwide India PVT LTD',
    invoiceDate: new Date(),
    grandTotal: 200.00,
    totalAmount: 200.00,
    cgstTotal: 4.76,
    sgstTotal: 4.76,
    buyersOrderNo: 'IND5973801',
    poDate: '2026-04-08',
    items: [
      {
        name: 'HYDRA STEEL WATER BOTTLE 1000ML',
        description: 'HYDRA STEEL WATER BOTTLE 1000ML',
        qty: 1,
        rate: 190.48,
        amount: 190.48,
        basic: 190.48,
        unit: 'Nos',
        cgst: 4.76,
        sgst: 4.76,
        hsn: '732393',
        tallySalesLedger: 'SS Bottle Sales Local 5%',
      }
    ]
  };

  console.log('Test invoice created');
  const tv = normalizeToTallyVoucher(testInvoice, { periodEnd: '20260702' });
  console.log('Normalized to tally voucher');
  console.log('allLedgerEntries:', tv.allLedgerEntries.map(e => ({ ledgerName: e.ledgerName, amount: e.amount })));
  const voucherXml = serializeTallyVoucher(tv, 'Create');
  console.log('Voucher XML generated (should NOT have SS Bottle Sales Local 5% in LEDGERENTRIES.LIST):');
  console.log(voucherXml);

  const envelope = importEnvelope(cfg, 'Vouchers', voucherXml);
  console.log('Full envelope generated');
  
  const resp = await postXmlWithRetry(cfg, envelope, 30000, 1);
  console.log('\n\nTALLY RESPONSE (EXACT):');
  console.log(resp);
  console.log('\n\nTest complete');
}

runTest().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
