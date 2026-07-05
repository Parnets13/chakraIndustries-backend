import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import TallyConfig from '../models/TallyConfig.js';

await mongoose.connect(process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const url = cfg.tallyLocalUrl || 'http://localhost:9000';
const co  = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim().toUpperCase();

const now = new Date();
const D   = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
const JUNE = '20260616'; // BIW11 actual invoice date

// Static vars WITH full financial year range
const sv = `<STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES>`;

const post = async (xml, label) => {
  try {
    const r  = await axios.post(url, xml, { headers:{'Content-Type':'text/xml'}, timeout:20000 });
    const b  = String(r.data||'');
    const le = [...b.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
    const c  = parseInt(b.match(/<CREATED>(\d+)/i)?.[1]||'0');
    const e  = parseInt(b.match(/<EXCEPTIONS>(\d+)/i)?.[1]||'0');
    console.log(`[${label}] created=${c} exceptions=${e}${le.length?'  ERR:'+le.join('|'):' ✅'}`);
  } catch(err) { console.log(`[${label}] TIMEOUT: ${err.message}`); }
};

const wrap = (date, vno, inner) => `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create">
<DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE>
<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
<ISINVOICE>Yes</ISINVOICE>
<NARRATION>${inner}</NARRATION>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE><AMOUNT>-230.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Output CGST @ 2.5%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>5.48</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Output SGST @ 2.5%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>5.48</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Accounts</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>219.04</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

console.log(`Testing with SVFROMDATE=20260401 SVTODATE=20270331\n`);

// T1: June date (BIW11 actual date), no voucher number
await post(wrap(JUNE, '', 'ERP Inv: BIW11-T1'), 'June date, no VNO');

// T2: Today's date, no voucher number  
await post(wrap(D, '', 'ERP Inv: BIW11-T2'), 'Today date, no VNO');

// T3: June date WITH voucher number
const vno3 = `BIW11-T3-${Date.now().toString().slice(-4)}`;
const xml3 = wrap(JUNE, vno3, 'ERP Inv: BIW11-T3').replace('<ISINVOICE>Yes</ISINVOICE>', `<VOUCHERNUMBER>${vno3}</VOUCHERNUMBER><ISINVOICE>Yes</ISINVOICE>`);
await post(xml3, `June date, VNO=${vno3}`);

// T4: Try with SCI prefix number (matching Tally's own series)
const sciVno = `SCI99${Date.now().toString().slice(-3)}`;
const xml4 = wrap(D, '', `ERP Inv: BIW11-T4 | ${sciVno}`).replace('<ISINVOICE>Yes</ISINVOICE>', `<VOUCHERNUMBER>${sciVno}</VOUCHERNUMBER><ISINVOICE>Yes</ISINVOICE>`);
await post(xml4, `SCI-series VNO=${sciVno}`);

// T5: Tally format — no number, but REMOTEID set
const xml5 = wrap(JUNE, '', 'ERP Inv: BIW11-T5 | HYDRA STEEL x1').replace(
  '<VOUCHER VCHTYPE="Sales" ACTION="Create">',
  `<VOUCHER VCHTYPE="Sales" ACTION="Create" REMOTEID="ERP-BIW11-${Date.now().toString().slice(-6)}">`
);
await post(xml5, 'REMOTEID set, no VNO');

await mongoose.disconnect();
console.log('\nDone.');
