/**
 * Sends BIW958 directly to Tally and prints the full raw XML response.
 * Run: node scripts/test-send-biw958.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice   from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ DB connected\n');

const inv = await Invoice.findOne({ invoiceNo: 'BIW958' }).lean();
if (!inv) { console.error('BIW958 not found'); process.exit(1); }

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();

// Enrich with item master
const itemNames = [...new Set((inv.items||[]).map(i=>(i.description||i.name||'').trim()).filter(Boolean))];
const masters = await ItemMaster.find({ name: { $in: itemNames } }, 'name hsn tallySalesLedger gst').lean();
const mm = new Map(masters.map(m=>[m.name,m]));
const enrichedItems = (inv.items||[]).map(item => {
  const n=(item.description||item.name||'').trim(), im=mm.get(n);
  return { ...item,
    hsn: (item.hsn||'').trim()||(im?.hsn||'').trim(),
    tallySalesLedger: (item.tallySalesLedger||'').trim()||(im?.tallySalesLedger||'').trim(),
    taxRate: item.taxRate || im?.gst || 0,
  };
});

const tv = normalizeToTallyVoucher({ ...inv, items: enrichedItems }, { salesVoucherTypeName: 'Sales' });

console.log('━━━ NORMALIZED VALUES ━━━');
console.log('grandTotal :', tv._grandTotal);
console.log('salesBase  :', tv._salesBase);
console.log('CGST       :', tv._totalCGST);
console.log('SGST       :', tv._totalSGST);
const ie = tv.allInventoryEntries[0];
console.log('item AMOUNT:', ie?.amount);
console.log('item RATE  :', ie?.rate);
console.log('rateDetails:', JSON.stringify(ie?.rateDetails));
console.log('');

const voucherXml = serializeTallyVoucher(tv, cfg, 'Create', '');

const co = (cfg?.companyName||'').trim().toUpperCase();
const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
const fullXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      ${voucherXml}
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

console.log('━━━ VOUCHER XML BEING SENT ━━━');
console.log(voucherXml);
console.log('');

console.log('⏳ Sending to Tally...');
try {
  const raw = await postXmlWithRetry(cfg, fullXml, 30000);
  console.log('━━━ TALLY RAW RESPONSE ━━━');
  console.log(raw);
  console.log('');
  const created    = raw.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1];
  const altered    = raw.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1];
  const exceptions = raw.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1];
  const errors     = [...raw.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
  console.log(`CREATED=${created} ALTERED=${altered} EXCEPTIONS=${exceptions}`);
  if (errors.length) errors.forEach(e => console.log('LINEERROR:', e));
} catch(e) {
  console.error('Send failed:', e.message);
}

await mongoose.disconnect();
