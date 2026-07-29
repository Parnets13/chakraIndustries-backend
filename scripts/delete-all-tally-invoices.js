/**
 * delete-all-tally-invoices.js
 * Deletes all Sales vouchers from Tally that were exported from ERP
 * so they can be re-exported fresh with correct Ship to place.
 * 
 * Run: node scripts/delete-all-tally-invoices.js
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

const cfg = await TallyConfig.findOne();
if (!cfg) { console.error('No TallyConfig found'); process.exit(1); }

const company = (cfg.companyName || '').trim().toUpperCase();
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// Get all exported invoices
const invoices = await Invoice.find({ 
  source: 'excel_upload',
  invoiceNo: { $exists: true, $ne: '' }
}).lean();

console.log(`Found ${invoices.length} invoices to delete from Tally`);

let deleted = 0, failed = 0;

for (const inv of invoices) {
  const invoiceNo = inv.invoiceNo;
  const voucherType = inv.tallyVoucher?.voucherType || 'Sales';
  const guid = inv.tallyGuid || inv.tallyVoucher?.guid || '';

  // Build delete XML
  const deleteXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
      <SVSHOWERRORLIST>Yes</SVSHOWERRORLIST>
    </STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="${esc(voucherType)}" ACTION="Delete" OBJVIEW="Invoice Voucher View">
        ${guid ? `<GUID>${esc(guid)}</GUID>` : ''}
        <VOUCHERTYPENAME>${esc(voucherType)}</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${esc(invoiceNo)}</VOUCHERNUMBER>
      </VOUCHER>
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

  try {
    const resp = await postXmlWithRetry(cfg, deleteXml, 30000, 1);
    if (resp.includes('EXCEPTIONS>0') || resp.includes('CREATED>0') || !resp.includes('EXCEPTIONS')) {
      console.log(`✓ Deleted: ${invoiceNo}`);
      deleted++;
    } else {
      console.log(`✗ Failed: ${invoiceNo} - ${resp.substring(0,200)}`);
      failed++;
    }
  } catch (e) {
    console.log(`✗ Error: ${invoiceNo} - ${e.message}`);
    failed++;
  }
}

// Reset tallySync status in DB so all invoices re-export
await Invoice.updateMany(
  { source: 'excel_upload' },
  { $set: { tallySync: false, tallyGuid: '', retryCount: 0 } }
);

console.log(`\n=== DONE ===`);
console.log(`Deleted: ${deleted}, Failed: ${failed}`);
console.log(`All invoices marked for re-export in DB`);

await mongoose.disconnect();
