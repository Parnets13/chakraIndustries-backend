/**
 * Finds and deletes the test voucher with number "1" from Tally
 * that is blocking all new Sales voucher imports.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import TallyConfig from '../models/TallyConfig.js';

await mongoose.connect(process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const url = cfg.tallyLocalUrl || 'http://localhost:9000';
const co  = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim().toUpperCase();

function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

// Step 1: Find all Sales vouchers with number "1"
console.log('Looking for voucher number "1" in Tally...');
const findXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FindV1</ID></HEADER>
<BODY><DESC>
<STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="FindV1"><TYPE>Voucher</TYPE><FETCH>VoucherNumber,Date,GUID,VoucherTypeName</FETCH></COLLECTION>
</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

const r1 = await axios.post(url, findXml, { headers:{'Content-Type':'text/xml'}, timeout:30000 });
const b1 = String(r1.data||'');
const blocks = [...b1.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)].map(m=>m[1]);

// Find all that have VOUCHERNUMBER = 1
const v1s = blocks.filter(bl => {
  const vno = (bl.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim();
  return vno === '1';
}).map(bl => ({
  vno:  (bl.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim(),
  type: (bl.match(/<VOUCHERTYPENAME>(.*?)<\/VOUCHERTYPENAME>/i)?.[1]||'').trim(),
  date: (bl.match(/<DATE>(.*?)<\/DATE>/i)?.[1]||'').trim(),
  guid: (bl.match(/<GUID>(.*?)<\/GUID>/i)?.[1]||'').trim(),
}));

console.log(`Found ${v1s.length} voucher(s) with number "1":`);
v1s.forEach(v => console.log(`  type=${v.type}  date=${v.date}  guid=${v.guid}`));

if (v1s.length === 0) {
  console.log('\nNo voucher "1" found. The issue may be something else.');
  await mongoose.disconnect();
  process.exit(0);
}

// Step 2: Delete each one using ALTER ACTION=Delete
for (const v of v1s) {
  if (!v.guid) { console.log('  No GUID — cannot delete via API'); continue; }
  console.log(`\nDeleting voucher "1" (type=${v.type}) GUID=${v.guid}...`);

  const delXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${esc(v.type)}" ACTION="Delete">
  <GUID>${esc(v.guid)}</GUID>
  <DATE>${v.date}</DATE>
  <VOUCHERTYPENAME>${esc(v.type)}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>1</VOUCHERNUMBER>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

  const r2 = await axios.post(url, delXml, { headers:{'Content-Type':'text/xml'}, timeout:20000 });
  const b2 = String(r2.data||'');
  const le = [...b2.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
  const deleted = parseInt(b2.match(/<DELETED>(\d+)/i)?.[1]||'0');
  const e = parseInt(b2.match(/<EXCEPTIONS>(\d+)/i)?.[1]||'0');
  console.log(`  deleted=${deleted}  exceptions=${e}${le.length?' ERR:'+le.join('|'):''}`);
}

// Step 3: Now try a fresh Sales voucher
console.log('\nTesting fresh Sales voucher after deletion...');
const D = `${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')}`;
const testXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES>
</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create">
<DATE>20260616</DATE><EFFECTIVEDATE>20260616</EFFECTIVEDATE>
<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
<ISINVOICE>Yes</ISINVOICE>
<NARRATION>ERP Inv: BIW11 | HYDRA STEEL WATER BOTTLE 1000ML x1</NARRATION>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE><AMOUNT>-230.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Output CGST @ 2.5%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>5.48</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Output SGST @ 2.5%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>5.48</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Accounts</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>219.04</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

const r3 = await axios.post(url, testXml, { headers:{'Content-Type':'text/xml'}, timeout:20000 });
const b3 = String(r3.data||'');
const le3 = [...b3.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
const c3 = parseInt(b3.match(/<CREATED>(\d+)/i)?.[1]||'0');
const e3 = parseInt(b3.match(/<EXCEPTIONS>(\d+)/i)?.[1]||'0');
console.log(`Test voucher: created=${c3}  exceptions=${e3}${le3.length?' ERR:'+le3.join('|'):''}`);

await mongoose.disconnect();
