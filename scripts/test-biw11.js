import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import Invoice from '../models/Invoice.js';
import TallyConfig from '../models/TallyConfig.js';

await mongoose.connect(process.env.MONGO_URI);
const inv = await Invoice.findOne({ invoiceNo: 'BIW11' }).lean();
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const url = cfg.tallyLocalUrl || 'http://localhost:9000';
const co  = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').toUpperCase();

const dt   = new Date(inv.invoiceDate);
const date = `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
// Also test with today's date to see if it's a financial year issue
const today = new Date();
const todayDate = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
console.log(`invoice date: ${date}  today: ${todayDate}`);const grand = +(inv.grandTotal||0).toFixed(2);
const cgst  = +(inv.items?.[0]?.cgst||0).toFixed(2);
const sgst  = +(inv.items?.[0]?.sgst||0).toFixed(2);
const tax   = +(cgst+sgst).toFixed(2);
const base  = +(grand-tax).toFixed(2);
const sum   = +(-grand+cgst+sgst+base).toFixed(4);

console.log(`date:${date}  grand:${grand}  cgst:${cgst}  sgst:${sgst}  base:${base}  balance:${sum}`);
console.log(`party: "${inv.partyName}"`);

const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create">
<DATE>${date}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<VOUCHERNUMBER>BIW11-DBGTEST</VOUCHERNUMBER>
<PARTYLEDGERNAME>${inv.partyName}</PARTYLEDGERNAME>
<ISINVOICE>Yes</ISINVOICE>
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>${inv.partyName}</LEDGERNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
  <AMOUNT>-${grand}</AMOUNT>
  <BILLALLOCATIONS.LIST><NAME>BIW11-DBGTEST</NAME><BILLTYPE>New Ref</BILLTYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><AMOUNT>-${grand}</AMOUNT></BILLALLOCATIONS.LIST>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>Output CGST @ 2.5%</LEDGERNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
  <AMOUNT>${cgst}</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>Output SGST @ 2.5%</LEDGERNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
  <AMOUNT>${sgst}</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>Sales Accounts</LEDGERNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
  <AMOUNT>${base}</AMOUNT>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

console.log('\nTest 1: Original invoice date (June 16)');
const r = await axios.post(url, xml, { headers: { 'Content-Type': 'text/xml' }, timeout: 30000 });
const b = String(r.data||'');
const le = [...b.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
const c  = parseInt(b.match(/<CREATED>(\d+)/i)?.[1]||'0');
const e  = parseInt(b.match(/<EXCEPTIONS>(\d+)/i)?.[1]||'0');
console.log(`created=${c}  exceptions=${e}${le.length ? '  LINEERR: '+le.join(' | ') : ''}`);

// Test 2: Same voucher with today's date
console.log('\nTest 2: Today date instead');
const xml2 = xml.replace(`<DATE>${date}</DATE>`, `<DATE>${todayDate}</DATE>`)
               .replace('BIW11-DBGTEST', 'BIW11-TODAYTEST');
const r2 = await axios.post(url, xml2, { headers: { 'Content-Type': 'text/xml' }, timeout: 30000 });
const b2 = String(r2.data||'');
const le2 = [...b2.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
const c2  = parseInt(b2.match(/<CREATED>(\d+)/i)?.[1]||'0');
const e2  = parseInt(b2.match(/<EXCEPTIONS>(\d+)/i)?.[1]||'0');
console.log(`created=${c2}  exceptions=${e2}${le2.length ? '  LINEERR: '+le2.join(' | ') : ''}`);

// Test 3: Check if it's the amount — try simple 200 fixed amount
console.log('\nTest 3: Simple 200 amount (same as BIW01 which worked)');
const xml3 = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create">
<DATE>${todayDate}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<VOUCHERNUMBER>BIW11-AMT200TEST</VOUCHERNUMBER>
<PARTYLEDGERNAME>${inv.partyName}</PARTYLEDGERNAME>
<ISINVOICE>Yes</ISINVOICE>
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>${inv.partyName}</LEDGERNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
  <AMOUNT>-200.00</AMOUNT>
  <BILLALLOCATIONS.LIST><NAME>BIW11-AMT200TEST</NAME><BILLTYPE>New Ref</BILLTYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><AMOUNT>-200.00</AMOUNT></BILLALLOCATIONS.LIST>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>Sales Accounts</LEDGERNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
  <AMOUNT>200.00</AMOUNT>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
const r3 = await axios.post(url, xml3, { headers: { 'Content-Type': 'text/xml' }, timeout: 30000 });
const b3 = String(r3.data||'');
const le3 = [...b3.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
const c3  = parseInt(b3.match(/<CREATED>(\d+)/i)?.[1]||'0');
const e3  = parseInt(b3.match(/<EXCEPTIONS>(\d+)/i)?.[1]||'0');
console.log(`created=${c3}  exceptions=${e3}${le3.length ? '  LINEERR: '+le3.join(' | ') : ''}`);

// Test 4: Completely fresh party
console.log('\nTest 4: Fresh party ledger');
const freshParty = `TEST-PARTY-${Date.now().toString().slice(-5)}`;
const xml4m = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${freshParty}" ACTION="Create"><NAME>${freshParty}</NAME><PARENT>Sundry Debtors</PARENT></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
await axios.post(url, xml4m, { headers: { 'Content-Type': 'text/xml' }, timeout: 20000 });
const xml4 = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>${todayDate}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>FRESHTEST-001</VOUCHERNUMBER><PARTYLEDGERNAME>${freshParty}</PARTYLEDGERNAME><ISINVOICE>Yes</ISINVOICE><ALLLEDGERENTRIES.LIST><LEDGERNAME>${freshParty}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE><AMOUNT>-200.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>FRESHTEST-001</NAME><BILLTYPE>New Ref</BILLTYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><AMOUNT>-200.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Accounts</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>200.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
const r4 = await axios.post(url, xml4, { headers: { 'Content-Type': 'text/xml' }, timeout: 30000 });
const b4 = String(r4.data||'');
const le4 = [...b4.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
const c4  = parseInt(b4.match(/<CREATED>(\d+)/i)?.[1]||'0');
const e4  = parseInt(b4.match(/<EXCEPTIONS>(\d+)/i)?.[1]||'0');
console.log(`party="${freshParty}"  created=${c4}  exceptions=${e4}${le4.length ? '  LINEERR: '+le4.join(' | ') : ''}`);

await mongoose.disconnect();
