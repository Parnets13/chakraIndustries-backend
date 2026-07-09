/**
 * check-sales-vchtype2.js — round 2: find exact working format with inventory
 */
import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import dotenv from 'dotenv';
dotenv.config();

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

await mongoose.connect(process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const company = (cfg.companyName || '').trim().toUpperCase();
const coTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
const sv = `<STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>`;

async function send(xml, label) {
  console.log(`\n${'='.repeat(50)}\nTEST: ${label}`);
  const resp = await postXmlWithRetry(cfg, xml, 30000);
  const created = resp.match(/<CREATED>(\d+)/i)?.[1] || '0';
  const exceptions = resp.match(/<EXCEPTIONS>(\d+)/i)?.[1] || '0';
  const lineerror = resp.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i)?.[1] || '';
  const lasterror = resp.match(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/i)?.[1] || '';
  console.log(`created=${created} exceptions=${exceptions}`);
  if (lineerror) console.log('LINEERROR:', lineerror);
  if (lasterror) console.log('LASTERROR:', lasterror);
  return created !== '0';
}

// Get all voucher types
const vtResp = await postXmlWithRetry(cfg, `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VT</ID></HEADER><BODY><DESC><STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="VT"><TYPE>VoucherType</TYPE><FETCH>Name,NumberingMethod,IsDeemedPositive</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`, 30000);
const vtNames = [...vtResp.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m=>m[1]).filter(Boolean);
console.log('ALL voucher types:', vtNames.join(', '));

const date = '20260702';

// Test with every sales-like voucher type
for (const vt of vtNames.filter(n => /sales|invoice/i.test(n))) {
  await send(`<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${esc(vt)}" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>${esc(vt)}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>VT-${Date.now()}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE><NARRATION>Test ${vt}</NARRATION>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-500.00</AMOUNT>
    <BILLALLOCATIONS.LIST><NAME>VT-${Date.now()}</NAME><BILLTYPE>New Ref</BILLTYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><AMOUNT>-500.00</AMOUNT></BILLALLOCATIONS.LIST>
  </LEDGERENTRIES.LIST>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>500.00</AMOUNT>
  </LEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>500.00/Nos</RATE><AMOUNT>500.00</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY><BILLEDQTY>1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>500.00</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`, `VoucherType="${vt}" with inventory`);
}

await mongoose.disconnect();
