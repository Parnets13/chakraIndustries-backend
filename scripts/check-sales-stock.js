/**
 * check-sales-stock.js — test if the stock item exists and if a simpler item name works
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
const date = '20260702';
let n = 0;
const vno = () => `STK-${Date.now()}-${++n}`;

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
}

// 1. Check if HYDRA item exists in Tally
const itemResp = await postXmlWithRetry(cfg, `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>IT</ID></HEADER>
<BODY><DESC><STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="IT"><TYPE>StockItem</TYPE><FETCH>Name</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`, 30000);
const itemNames = [...itemResp.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m=>m[1]).filter(Boolean);
console.log('Total stock items:', itemNames.length);
const hydra = itemNames.find(n => n.toLowerCase().includes('hydra'));
console.log('HYDRA item found:', hydra || 'NOT FOUND');
const firstItem = itemNames[0];
console.log('First item:', firstItem);

// 2. Check Sales Accounts ledger AFFECTSSTOCK
const saResp = await postXmlWithRetry(cfg, `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Ledger</SUBTYPE><ID>Sales Accounts</ID></HEADER>
<BODY><DESC><STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>`, 30000);
const affectsStock = saResp.match(/<AFFECTSSTOCK>(.*?)<\/AFFECTSSTOCK>/i)?.[1] || 'NOT FOUND';
const isRevenue = saResp.match(/<ISREVENUE>(.*?)<\/ISREVENUE>/i)?.[1] || 'NOT FOUND';
console.log('\nSales Accounts AFFECTSSTOCK:', affectsStock);
console.log('Sales Accounts ISREVENUE:', isRevenue);

// 3. Try with FIRST real stock item from Tally
if (firstItem) {
  const vn = vno();
  await send(`<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>${vn}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE><NARRATION>Test with existing item</NARRATION>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-500.00</AMOUNT>
    <BILLALLOCATIONS.LIST><NAME>${vn}</NAME><BILLTYPE>New Ref</BILLTYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><AMOUNT>-500.00</AMOUNT></BILLALLOCATIONS.LIST>
  </LEDGERENTRIES.LIST>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>500.00</AMOUNT>
  </LEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(firstItem)}</STOCKITEMNAME>
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
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`, `With existing item "${firstItem}"`);
}

// 4. First create the item then try
const vn4a = vno();
await send(`<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${sv}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<STOCKITEM NAME="Test Widget" ACTION="Create"><NAME>Test Widget</NAME><UNITS>Nos</UNITS></STOCKITEM>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`, 'Create test stock item');

const vn4 = vno();
await send(`<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>${vn4}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE><NARRATION>Test</NARRATION>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-500.00</AMOUNT>
    <BILLALLOCATIONS.LIST><NAME>${vn4}</NAME><BILLTYPE>New Ref</BILLTYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><AMOUNT>-500.00</AMOUNT></BILLALLOCATIONS.LIST>
  </LEDGERENTRIES.LIST>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>500.00</AMOUNT>
  </LEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>Test Widget</STOCKITEMNAME>
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
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`, 'New item "Test Widget" in ALLINVENTORYENTRIES');

await mongoose.disconnect();
