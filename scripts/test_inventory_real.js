// Test script using the exact same structure as pushSalesVouchersToTally!
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from '../config/database.js';
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

  // Build voucher exactly like pushSalesVouchersToTally!
  const grandTotal = 200.00;
  const cgst = 4.76;
  const sgst = 4.76;
  const igst = 0.00;
  const totalTax = cgst + sgst + igst;
  const salesBase = grandTotal - totalTax;
  const invoiceNo = 'TEST-INV-016';
  const partyName = 'BI Worldwide India PVT LTD';
  const voucherDate = tallyDate(new Date());
  const cgstLedger = 'Output CGST @ 9%';
  const sgstLedger = 'Output SGST @ 9%';

  const batchInvItems = [
    {
      description: 'HYDRA STEEL WATER BOTTLE 1000ML',
      qty: 1,
      rate: 190.48,
      amount: 190.48,
      tallySalesLedger: 'Sales',
    }
  ];
  const useBatchInventory = true;
  
  // Build inventory entries exactly like pushSalesVouchersToTally
  let batchInvAllocated = 0;
  const batchInventoryXml = useBatchInventory ? batchInvItems.map((item, i) => {
    const itemName    = (item.description || item.name || '').trim();
    const itemQty     = +(item.qty || 1);
    const itemRate    = +(item.rate || 0);
    const isLast      = i === batchInvItems.length - 1;
    const itemAmt     = isLast
      ? +(salesBase - batchInvAllocated).toFixed(2)
      : item.amount;
    batchInvAllocated = +(batchInvAllocated + (isLast ? itemAmt : item.amount)).toFixed(2);
    const negItemAmt  = -Math.abs(itemAmt);
    const itemUnit    = 'Nos';
    const salesLedger = (item.tallySalesLedger || 'Sales').trim();
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

  const voucherXml = `
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${voucherDate}</DATE>
  <EFFECTIVEDATE>${voucherDate}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(invoiceNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(partyName)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>${esc('Test invoice with inventory')}</NARRATION>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(invoiceNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </LEDGERENTRIES.LIST>
  ${cgst > 0 && cgstLedger ? `<LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(cgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${cgst.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : ''}
  ${sgst > 0 && sgstLedger ? `<LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(sgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${sgst.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : ''}
  ${!useBatchInventory ? `<LEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${(totalTax > 0 ? salesBase : grandTotal).toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : ''}
  ${batchInventoryXml}
</VOUCHER>`;

  console.log('Voucher XML generated (exact pushSalesVouchersToTally structure):');
  console.log(voucherXml);

  const envelope = importEnvelope(cfg, 'Vouchers', voucherXml);
  console.log('Full envelope generated');
  console.log(envelope);

  const resp = await postXmlWithRetry(cfg, envelope, 30000, 1);
  console.log('\n\nTALLY RESPONSE (EXACT):');
  console.log(resp);
  console.log('\n\nTest complete');
}

runTest().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
