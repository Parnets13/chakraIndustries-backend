// Test script for Purchase Orders with Inventory!
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

  // Test PO data!
  const poNumber = 'TEST-PO-016';
  const vendorName = 'Livpure Smart Homes';
  const voucherDate = tallyDate(new Date());
  
  const items = [
    { name: 'Test Raw Material 1', qty: 5, basePrice: 100, unit: 'Nos' },
    { name: 'Test Raw Material 2', qty: 10, basePrice: 50, unit: 'Nos' }
  ];
  
  const subtotal = items.reduce((sum, item) => sum + (item.qty * item.basePrice), 0);
  const cgst = subtotal * 0.09; // 9%
  const sgst = subtotal * 0.09; // 9%
  const igst = 0;
  const grandTotal = subtotal + cgst + sgst + igst;

  // Build inventory entries!
  let purAllocated = 0;
  const inventoryLines = items.map((item, i) => {
    const qty = item.qty;
    const rate = item.basePrice;
    const total = qty * rate;
    const unit = item.unit || 'Nos';
    const isLast = i === items.length - 1;
    const lineAlloc = isLast
      ? +(subtotal - purAllocated).toFixed(2)
      : total;
    purAllocated = +(purAllocated + lineAlloc).toFixed(2);

    return `
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(item.name)}</STOCKITEMNAME>
    <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
    <GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISGSTASSESSABLEVALUEOVERRIDDEN>No</ISGSTASSESSABLEVALUEOVERRIDDEN>
    <RATE>${rate.toFixed(2)}/${unit}</RATE>
    <AMOUNT>${lineAlloc.toFixed(2)}</AMOUNT>
    <ACTUALQTY>${qty} ${unit}</ACTUALQTY>
    <BILLEDQTY>${qty} ${unit}</BILLEDQTY>
    <BATCHALLOCATIONS.LIST>
      <AMOUNT>${lineAlloc.toFixed(2)}</AMOUNT>
      <ACTUALQTY>${qty} ${unit}</ACTUALQTY>
      <BILLEDQTY>${qty} ${unit}</BILLEDQTY>
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

  const voucherXml = `
<VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${voucherDate}</DATE>
  <EFFECTIVEDATE>${voucherDate}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(poNumber)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(vendorName)}</PARTYLEDGERNAME>
  <BUYERSORDERNO>${esc(poNumber)}</BUYERSORDERNO>
  <NARRATION></NARRATION>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(vendorName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(poNumber)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  ${cgst > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>CGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>${cgst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>` : ''}
  ${sgst > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>SGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>${sgst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>` : ''}
  ${igst > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>IGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>${igst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>` : ''}
  ${inventoryLines}
</VOUCHER>`;

  console.log('Purchase Voucher XML generated (exact exportPurchaseInvoices structure):');
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
