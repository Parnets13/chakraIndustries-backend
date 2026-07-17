/**
 * test-biw-date-formats.js
 * 
 * Tests sending BIW20 with different date formats to find what Tally accepts.
 * The voucher saves (party, items, GST all correct) but date field is blank.
 */
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import TallyConfig from '../models/TallyConfig.js';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}).lean();

function buildVoucher(voucherNo, dateValue) {
  return `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES><SVCURRENTCOMPANY>SRI CHAKRA INDUSTRIES</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${dateValue}</DATE>
  <EFFECTIVEDATE>${dateValue}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${voucherNo}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <BUYERSORDERNO>IND60710471</BUYERSORDERNO>
  <NARRATION>DATE FORMAT TEST: ${dateValue}</NARRATION>
  <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
  <STATENAME>Karnataka</STATENAME>
  <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
  <PARTYGSTIN>29AAECB5878L1ZY</PARTYGSTIN>
  <PLACEOFSUPPLY>Karnataka</PLACEOFSUPPLY>
  <GSTREGISTRATION TAXTYPE="GST" TAXREGISTRATION="29ABWFS0002M1ZR">Karnataka Registration</GSTREGISTRATION>
  <CMPGSTIN>29ABWFS0002M1ZR</CMPGSTIN>
  <CMPGSTSTATE>Karnataka</CMPGSTSTATE>
  <CMPGSTREGISTRATIONTYPE>Regular</CMPGSTREGISTRATIONTYPE>
  <VCHSTATUSTAXUNIT>Karnataka Registration</VCHSTATUSTAXUNIT>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-230.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${voucherNo}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-230.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </LEDGERENTRIES.LIST>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>Output CGST @ 2.5%</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>5.48</AMOUNT>
  </LEDGERENTRIES.LIST>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>Output SGST @ 2.5%</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>5.48</AMOUNT>
  </LEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>219.05/Nos</RATE>
    <AMOUNT>-219.04</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY>
    <BILLEDQTY>1 Nos</BILLEDQTY>
    <GSTSOURCETYPE>Ledger</GSTSOURCETYPE>
    <GSTLEDGERSOURCE>SS Bottle Sales Local 5%</GSTLEDGERSOURCE>
    <HSNSOURCETYPE>Ledger</HSNSOURCETYPE>
    <HSNLEDGERSOURCE>SS Bottle Sales Local 5%</HSNLEDGERSOURCE>
    <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
    <GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
    <GSTHSNNAME>732393</GSTHSNNAME>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>SS Bottle Sales Local 5%</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>-219.04</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;
}

// Test 1: YYYYMMDD format (current)
console.log('\n--- Test 1: YYYYMMDD (20260707) ---');
let resp = await postXmlWithRetry(cfg, buildVoucher('DATETEST001', '20260707'), 30000, 1);
console.log(resp.match(/<CREATED>\d+<\/CREATED>/)?.[0]);
console.log(resp.match(/<LINEERROR>.*?<\/LINEERROR>/)?.[0] || 'no error');
console.log(resp.match(/<EXCEPTIONS>\d+<\/EXCEPTIONS>/)?.[0]);

// Test 2: Try today's date (20260715) with same party/items
console.log('\n--- Test 2: Today (20260715) with same BIW party ---');
resp = await postXmlWithRetry(cfg, buildVoucher('DATETEST002', '20260715'), 30000, 1);
console.log(resp.match(/<CREATED>\d+<\/CREATED>/)?.[0]);
console.log(resp.match(/<LINEERROR>.*?<\/LINEERROR>/)?.[0] || 'no error');
console.log(resp.match(/<EXCEPTIONS>\d+<\/EXCEPTIONS>/)?.[0]);

// Test 3: Try a date from last month (20260615)
console.log('\n--- Test 3: Last month (20260615) ---');
resp = await postXmlWithRetry(cfg, buildVoucher('DATETEST003', '20260615'), 30000, 1);
console.log(resp.match(/<CREATED>\d+<\/CREATED>/)?.[0]);
console.log(resp.match(/<LINEERROR>.*?<\/LINEERROR>/)?.[0] || 'no error');
console.log(resp.match(/<EXCEPTIONS>\d+<\/EXCEPTIONS>/)?.[0]);

await mongoose.disconnect();
console.log('\nDone. Check which date format/range works.');
