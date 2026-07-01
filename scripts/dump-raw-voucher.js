/**
 * dump-raw-voucher.js
 * Fetches raw XML from Tally for Sales vouchers and dumps the first
 * voucher block that has a different bill-to and ship-to party.
 * Run: node scripts/dump-raw-voucher.js
 */
import dotenv from 'dotenv';
dotenv.config();
import dns from 'dns';
import mongoose from 'mongoose';
import fs from 'fs';

dns.setServers(['8.8.8.8', '8.8.4.4']);
await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

const TallyConfig  = (await import('../models/TallyConfig.js')).default;
const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });

// Build AllVouchers XML for a small recent date range
const today = new Date();
const from  = new Date(2026, 5, 1);  // June 1 2026
const to    = new Date(2026, 5, 30); // June 30 2026

function td(d) {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const co = (cfg.companyName || '').trim();
const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SalesVouchers</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>
    <SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVFROMDATE>${td(from)}</SVFROMDATE>
    <SVTODATE>${td(to)}</SVTODATE>
  </STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="SalesVouchers">
      <TYPE>Voucher</TYPE>
      <FETCH>GUID, VoucherNumber, Date, VoucherTypeName, PartyLedgerName,
             BILLTONAME, BILLTOMAILINGNAME, BILLTOADDRESS, BILLTOGSTIN, BILLTOSTATE, BILLTOCOUNTRY, BILLTOPINCODE, BILLTOGSTREGISTRATIONTYPE,
             BASICBUYERNAME, BASICBUYERADDRESS, BASICBUYERADDRESS.LIST,
             CONSIGNEENAME, CONSIGNEEMAILINGNAME, CONSIGNEEADDRESS, CONSIGNEEGSTIN, CONSIGNEESTATE, CONSIGNEECOUNTRY, CONSIGNEEPINCODE,
             SHIPTONAME, SHIPTOMAILINGNAME, SHIPTOADDRESS, SHIPTOGSTIN, SHIPTOSTATE, SHIPTOCOUNTRY, SHIPTOPINCODE,
             ALLLEDGERENTRIES.LIST, ALLINVENTORYENTRIES.LIST,
             PlaceOfSupply, PartyGSTIN, Narration</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

console.log('Fetching from Tally...');
const resp = await postXmlWithRetry(cfg, xml, 120000);

// Find SCI0949 block specifically
const idx = resp.indexOf('SCI0949');
if (idx === -1) {
  console.log('SCI0949 not found in response. Saving full response to raw-vouchers.xml');
  fs.writeFileSync('scripts/raw-vouchers.xml', resp);
} else {
  // Find the <VOUCHER block that contains SCI0949
  let start = resp.lastIndexOf('<VOUCHER', idx);
  let end = resp.indexOf('</VOUCHER>', idx) + '</VOUCHER>'.length;
  const block = resp.slice(start, end);
  console.log('\n=== RAW XML FOR SCI0949 ===\n');
  console.log(block);
  fs.writeFileSync('scripts/SCI0949-raw.xml', block);
  console.log('\nAlso saved to scripts/SCI0949-raw.xml');
}

await mongoose.disconnect();
