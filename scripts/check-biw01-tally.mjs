import 'dotenv/config';
import connectDB from '../config/database.js';
import Invoice from '../models/Invoice.js';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

await connectDB();

// Check BIW01 in DB
const inv = await Invoice.findOne({ invoiceNo: 'BIW01' }).lean();
console.log('BIW01 DB state:');
console.log('  tallySync:', inv?.tallySync);
console.log('  retryCount:', inv?.retryCount);
console.log('  grandTotal:', inv?.grandTotal);

// Check if BIW01 already exists in Tally
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const co = (cfg.companyName || '').trim().toUpperCase();

const checkXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ERPCheck</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="ERPCheck"><TYPE>Voucher</TYPE><FETCH>VoucherNumber,Date,VoucherTypeName</FETCH>
      <FILTER>IsVno</FILTER></COLLECTION>
    <FUNCTION NAME="IsVno"><PARAMETER NAME="Vch">Voucher</PARAMETER>
      <RETURN>$$StringFind:$VoucherNumber:"BIW01"</RETURN></FUNCTION>
  </TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

try {
  const resp = await postXmlWithRetry(cfg, checkXml, 15000, 1);
  const hasVoucher = resp.includes('BIW01');
  console.log('\nBIW01 exists in Tally:', hasVoucher);
  if (hasVoucher) {
    const dateMatch = resp.match(/<DATE[^>]*>(\d{8})<\/DATE>/i);
    console.log('  Found date:', dateMatch?.[1]);
  }
} catch(e) {
  console.log('Could not check Tally:', e.message);
}

// Also directly test minimal BIW01 import to get exact error
const axios = (await import('axios')).default;
const url = cfg.tallyLocalUrl || 'http://localhost:9000';
const testXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
<DATE>20260702</DATE><EFFECTIVEDATE>20260702</EFFECTIVEDATE>
<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<VOUCHERNUMBER>BIW01</VOUCHERNUMBER>
<PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
<ISINVOICE>Yes</ISINVOICE>
<LEDGERENTRIES.LIST><LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-200.00</AMOUNT>
<BILLALLOCATIONS.LIST><NAME>BIW01</NAME><BILLTYPE>New Ref</BILLTYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><AMOUNT>-200.00</AMOUNT></BILLALLOCATIONS.LIST>
</LEDGERENTRIES.LIST>
<LEDGERENTRIES.LIST><LEDGERNAME>Output CGST @ 2.5%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>4.76</AMOUNT></LEDGERENTRIES.LIST>
<LEDGERENTRIES.LIST><LEDGERNAME>Output SGST @ 2.5%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>4.76</AMOUNT></LEDGERENTRIES.LIST>
<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><RATE>190.48/Nos</RATE><AMOUNT>190.48</AMOUNT><ACTUALQTY>1 Nos</ACTUALQTY><BILLEDQTY>1 Nos</BILLEDQTY>
<GSTSOURCETYPE>Ledger</GSTSOURCETYPE><GSTLEDGERSOURCE>SS Bottle Sales Local 5%</GSTLEDGERSOURCE><HSNSOURCETYPE>Ledger</HSNSOURCETYPE><HSNLEDGERSOURCE>SS Bottle Sales Local 5%</HSNLEDGERSOURCE><GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY><GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY><GSTHSNNAME>732393</GSTHSNNAME>
<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>SS Bottle Sales Local 5%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>190.48</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>
</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

console.log('\nTesting direct minimal BIW01 import...');
const r = await axios.post(url, testXml, { headers: { 'Content-Type': 'text/xml' }, timeout: 20000 });
const body = String(r.data || '');
const created = parseInt(body.match(/<CREATED>(\d+)/i)?.[1] || '0');
const exceptions = parseInt(body.match(/<EXCEPTIONS>(\d+)/i)?.[1] || '0');
const lineErrors = [...body.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m => m[1].trim());
const lastErrors = [...body.matchAll(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/gi)].map(m => m[1].trim());
console.log(`created=${created} exceptions=${exceptions}`);
if (lineErrors.length) console.log('LINEERROR:', lineErrors.join(' | '));
if (lastErrors.length) console.log('LASTERROR:', lastErrors.join(' | '));
if (!lineErrors.length && !lastErrors.length && exceptions > 0) console.log('No error tags in response — raw:', body);

process.exit(0);
