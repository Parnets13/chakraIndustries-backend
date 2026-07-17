import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import TallyConfig from '../models/TallyConfig.js';

await mongoose.connect(process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const tallyUrl = cfg.tallyLocalUrl || 'http://localhost:9000';
const company  = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim().toUpperCase();

function esc(s) { return s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const coTag = `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>`;

// Get voucher types
const vt = await axios.post(tallyUrl, `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VT</ID></HEADER>
<BODY><DESC>
<STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="VT"><TYPE>VoucherType</TYPE><FETCH>Name,NumberingMethod</FETCH></COLLECTION>
</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`,
{ headers: {'Content-Type':'text/xml'}, timeout: 15000 });

const vtBody = String(vt.data||'');
const salesTypes = [...vtBody.matchAll(/<VOUCHERTYPE[^>]*>([\s\S]*?)<\/VOUCHERTYPE>/gi)]
  .map(m => m[1])
  .filter(b => /sales/i.test(b))
  .map(b => ({
    name: (b.match(/<NAME>(.*?)<\/NAME>/i)?.[1]||'?').trim(),
    numbering: (b.match(/<NUMBERINGMETHOD>(.*?)<\/NUMBERINGMETHOD>/i)?.[1]||'?').trim(),
  }));

console.log('Sales-type voucher types in Tally:');
salesTypes.forEach(v => console.log(`  "${v.name}"  numbering: ${v.numbering}`));

// Also get ALL voucher type names
const allTypes = [...vtBody.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m=>m[1].trim());
console.log('\nAll voucher types:', allTypes.join(', '));

// Now test with short voucher number and exact Sales type name
const DATE = '20260703';
const shortVno = 'TST001';
const salesTypeName = 'Sales'; // Use exact Tally voucher type name
console.log(`\nTesting with VOUCHERNUMBER=${shortVno} VCHTYPE="${salesTypeName}"`);

const sv = `<STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>`;
const resp = await axios.post(tallyUrl, `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${esc(salesTypeName)}" ACTION="Create">
  <DATE>${DATE}</DATE>
  <VOUCHERTYPENAME>${esc(salesTypeName)}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${shortVno}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-200.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>200.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <RATE>190.48/Nos</RATE>
    <AMOUNT>-200.00</AMOUNT>
    <ACTUALQTY> 1 Nos</ACTUALQTY><BILLEDQTY> 1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>-200.00</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`,
{ headers: {'Content-Type':'text/xml'}, timeout: 40000 });

const rb = String(resp.data||'');
const le = [...rb.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
const c  = parseInt(rb.match(/<CREATED>(\d+)/i)?.[1]||'0');
const e  = parseInt(rb.match(/<EXCEPTIONS>(\d+)/i)?.[1]||'0');
console.log(`Result: created=${c} exceptions=${e}`);
if (le.length) console.log('LINEERRORS:', le);
if (e>0 && !le.length) console.log('RAW:', rb.slice(0,500));

await mongoose.disconnect();
