import 'dotenv/config';
import connectDB from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';
import axios from 'axios';

await connectDB();
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const url = cfg.tallyLocalUrl || 'http://localhost:9000';
const co  = (cfg.companyName || '').trim().toUpperCase();

console.log(`Checking Tally at ${url}, company: "${co}"`);
console.log(`tallyPeriodEnd in DB: ${cfg.tallyPeriodEnd}`);

// Check what vouchers already exist in Tally
const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VchCheck</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="VchCheck"><TYPE>Voucher</TYPE><FETCH>VoucherNumber,Date,VoucherTypeName</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

try {
  const r = await axios.post(url, xml, { headers: { 'Content-Type': 'text/xml' }, timeout: 15000 });
  const body = String(r.data || '');
  
  // Extract all voucher numbers
  const voucherBlocks = [...body.matchAll(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/gi)];
  const numbers = [...body.matchAll(/<VOUCHERNUMBER[^>]*>(.*?)<\/VOUCHERNUMBER>/gi)].map(m => m[1].trim());
  const dates   = [...body.matchAll(/<DATE[^>]*>(\d{8})<\/DATE>/gi)].map(m => m[1]);
  
  console.log(`\nTotal vouchers found in Tally: ${numbers.length}`);
  
  // Show BIW, TEST, CLEAN, DATE vouchers
  const testVouchers = numbers.filter(v => /^(BIW|TEST|CLEAN|DATE|NEWTEST|REVTEST|SUBTRACT)/i.test(v));
  if (testVouchers.length) {
    console.log('\nTest/BIW vouchers in Tally:');
    testVouchers.forEach(v => console.log('  -', v));
  } else {
    console.log('\nNo BIW/test vouchers found in Tally');
  }
  
  // Show date range of existing vouchers
  if (dates.length) {
    const sorted = [...dates].sort();
    console.log(`\nVoucher date range: ${sorted[0]} to ${sorted[sorted.length-1]}`);
  }
  
  // Now try a simple test import with a NEW unique voucher number
  const testVno = `LOCALTEST-${Date.now().toString().slice(-6)}`;
  console.log(`\nTrying fresh import with vno=${testVno}...`);
  
  const importXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
<DATE>20260702</DATE><EFFECTIVEDATE>20260702</EFFECTIVEDATE>
<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<VOUCHERNUMBER>${testVno}</VOUCHERNUMBER>
<PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
<ISINVOICE>Yes</ISINVOICE>
<NARRATION>Local direct test ${testVno}</NARRATION>
<LEDGERENTRIES.LIST>
  <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
  <ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-200.00</AMOUNT>
  <BILLALLOCATIONS.LIST>
    <NAME>${testVno}</NAME><BILLTYPE>New Ref</BILLTYPE>
    <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><AMOUNT>-200.00</AMOUNT>
  </BILLALLOCATIONS.LIST>
</LEDGERENTRIES.LIST>
<LEDGERENTRIES.LIST>
  <LEDGERNAME>Output CGST @ 2.5%</LEDGERNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
  <ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>4.76</AMOUNT>
</LEDGERENTRIES.LIST>
<LEDGERENTRIES.LIST>
  <LEDGERNAME>Output SGST @ 2.5%</LEDGERNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
  <ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>4.76</AMOUNT>
</LEDGERENTRIES.LIST>
<ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
  <RATE>190.48/Nos</RATE><AMOUNT>190.48</AMOUNT>
  <ACTUALQTY>1 Nos</ACTUALQTY><BILLEDQTY>1 Nos</BILLEDQTY>
  <GSTSOURCETYPE>Ledger</GSTSOURCETYPE>
  <GSTLEDGERSOURCE>SS Bottle Sales Local 5%</GSTLEDGERSOURCE>
  <HSNSOURCETYPE>Ledger</HSNSOURCETYPE>
  <HSNLEDGERSOURCE>SS Bottle Sales Local 5%</HSNLEDGERSOURCE>
  <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
  <GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
  <GSTHSNNAME>732393</GSTHSNNAME>
  <BATCHALLOCATIONS.LIST>
    <GODOWNNAME>Srichakra Industries</GODOWNNAME>
    <BATCHNAME>Primary Batch</BATCHNAME>
    <DESTINATIONGODOWNNAME>Srichakra Industries</DESTINATIONGODOWNNAME>
    <INDENTNO>&#4; Not Applicable</INDENTNO>
    <ORDERNO>&#4; Not Applicable</ORDERNO>
    <TRACKINGNUMBER>&#4; Not Applicable</TRACKINGNUMBER>
    <DYNAMICCSTISCLEARED>No</DYNAMICCSTISCLEARED>
    <AMOUNT>190.48</AMOUNT><ACTUALQTY>1 Nos</ACTUALQTY><BILLEDQTY>1 Nos</BILLEDQTY>
    <ADDITIONALDETAILS.LIST></ADDITIONALDETAILS.LIST>
    <VOUCHERCOMPONENTLIST.LIST></VOUCHERCOMPONENTLIST.LIST>
  </BATCHALLOCATIONS.LIST>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>SS Bottle Sales Local 5%</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>190.48</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>
</VOUCHER>
  </TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

  const r2 = await axios.post(url, importXml, { headers: { 'Content-Type': 'text/xml' }, timeout: 20000 });
  const b2  = String(r2.data || '');
  const created    = parseInt(b2.match(/<CREATED>(\d+)/i)?.[1] || '0');
  const exceptions = parseInt(b2.match(/<EXCEPTIONS>(\d+)/i)?.[1] || '0');
  const lineErrors = [...b2.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m => m[1].trim());
  const lastErrors = [...b2.matchAll(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/gi)].map(m => m[1].trim());
  
  console.log(`Result: created=${created} exceptions=${exceptions}`);
  if (lineErrors.length) console.log('LINEERROR:', lineErrors.join(' | '));
  if (lastErrors.length) console.log('LASTERROR:', lastErrors.join(' | '));
  if (!lineErrors.length && !lastErrors.length && exceptions > 0) {
    console.log('RAW response:', b2);
  }

} catch(e) {
  console.log('Error:', e.message);
}

process.exit(0);
