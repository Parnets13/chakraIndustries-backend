/**
 * diagnose-final.js
 * Tests exactly what Tally Sales voucher type expects for date.
 * Also checks the Sales voucher type configuration.
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

const post = async (xml, label) => {
  try {
    const r = await axios.post(url, xml, { headers: {'Content-Type':'text/xml'}, timeout: 20000 });
    const b = String(r.data||'');
    const le = [...b.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
    const c  = parseInt(b.match(/<CREATED>(\d+)/i)?.[1]||'0');
    const e  = parseInt(b.match(/<EXCEPTIONS>(\d+)/i)?.[1]||'0');
    const status = c>0 ? '✅ created='+c : e>0 ? '❌ exceptions='+e : '⚠️ 0';
    console.log(`[${label}] ${status}${le.length ? '  ERR: '+le.join('|') : ''}`);
    return { c, e, le, b };
  } catch(err) {
    console.log(`[${label}] TIMEOUT/ERR: ${err.message}`);
    return { c:0, e:-1, le:[], b:'' };
  }
};

const sv  = `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY><SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>`;
const wrap = inner => `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${inner}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
const NOW  = new Date();
const D    = `${NOW.getFullYear()}${String(NOW.getMonth()+1).padStart(2,'0')}${String(NOW.getDate()).padStart(2,'0')}`;

console.log('Testing with date:', D, '\n');

// Get Sales voucher type config
const vtXml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VT3</ID></HEADER><BODY><DESC>
<STATICVARIABLES><SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="VT3"><TYPE>VoucherType</TYPE><FETCH>Name,UseEffectiveDatesForVouchers,PreventDuplicates,NumberingMethod</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

try {
  const r = await axios.post(url, vtXml, { headers:{'Content-Type':'text/xml'}, timeout:15000 });
  const b = String(r.data||'');
  const blocks = [...b.matchAll(/<VOUCHERTYPE[^>]*>([\s\S]*?)<\/VOUCHERTYPE>/gi)].map(m=>m[1]);
  const sales = blocks.find(x => /<NAME>Sales<\/NAME>/i.test(x));
  if (sales) {
    const effDates = sales.match(/<USEEFFECTIVEDATEFORVOUCHERS>(.*?)<\/USEEFFECTIVEDATEFORVOUCHERS>/i)?.[1] || 'not found';
    const dupCheck = sales.match(/<PREVENTDUPLICATES>(.*?)<\/PREVENTDUPLICATES>/i)?.[1] || 'not found';
    const numbering = sales.match(/<NUMBERINGMETHOD>(.*?)<\/NUMBERINGMETHOD>/i)?.[1] || 'not found';
    console.log(`Sales VT config:`);
    console.log(`  UseEffectiveDates : "${effDates}"`);
    console.log(`  PreventDuplicates : "${dupCheck}"`);
    console.log(`  NumberingMethod   : "${numbering}"`);
  } else {
    console.log('Sales VT block not found in response');
    console.log('Response:', b.slice(0, 500));
  }
} catch(e) { console.log('VT check error:', e.message); }

console.log('');

// T1: Simplest possible Sales voucher - no EFFECTIVEDATE
await post(wrap(`<VOUCHER VCHTYPE="Sales" ACTION="Create">
<DATE>${D}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<VOUCHERNUMBER>DIAG-NOEFF-${Date.now().toString().slice(-4)}</VOUCHERNUMBER>
<PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
<ISINVOICE>Yes</ISINVOICE>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE><AMOUNT>-200.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Accounts</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>200.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER>`), 'T1: No EFFECTIVEDATE');

// T2: With EFFECTIVEDATE
await post(wrap(`<VOUCHER VCHTYPE="Sales" ACTION="Create">
<DATE>${D}</DATE><EFFECTIVEDATE>${D}</EFFECTIVEDATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<VOUCHERNUMBER>DIAG-EFF-${Date.now().toString().slice(-4)}</VOUCHERNUMBER>
<PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
<ISINVOICE>Yes</ISINVOICE>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE><AMOUNT>-200.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Accounts</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>200.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER>`), 'T2: With EFFECTIVEDATE');

// T3: NUMBERINGSTYLE Manual + EFFECTIVEDATE  
await post(wrap(`<VOUCHER VCHTYPE="Sales" ACTION="Create">
<DATE>${D}</DATE><EFFECTIVEDATE>${D}</EFFECTIVEDATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<NUMBERINGSTYLE>Manual</NUMBERINGSTYLE>
<VOUCHERNUMBER>DIAG-MANU-${Date.now().toString().slice(-4)}</VOUCHERNUMBER>
<PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
<ISINVOICE>Yes</ISINVOICE>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE><AMOUNT>-200.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Accounts</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>200.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER>`), 'T3: NUMBERINGSTYLE Manual + EFFECTIVEDATE');

// T4: Empty voucher number (let Tally auto-assign)
await post(wrap(`<VOUCHER VCHTYPE="Sales" ACTION="Create">
<DATE>${D}</DATE><EFFECTIVEDATE>${D}</EFFECTIVEDATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
<ISINVOICE>Yes</ISINVOICE>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE><AMOUNT>-200.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Accounts</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>200.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER>`), 'T4: No voucher number (auto)');

await mongoose.disconnect();
console.log('\nDone.');
