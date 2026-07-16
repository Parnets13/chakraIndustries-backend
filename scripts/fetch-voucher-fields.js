/**
 * fetch-voucher-fields.js
 * Fetches a sales voucher from Tally and prints ALL its fields.
 * This tells us exactly which XML tag = "Order No(s)" and which = "Other Reference".
 *
 * Run: node --experimental-vm-modules scripts/fetch-voucher-fields.js
 */
import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const co = (cfg.companyName || '').trim().toUpperCase();

// Fetch ALL fields of the first 2 Sales vouchers so we can see the dispatch detail field names
const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>SalesVoucherDump</ID>
</HEADER>
<BODY>
  <DESC>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="SalesVoucherDump">
        <TYPE>Voucher</TYPE>
        <FILTERS>IsSales</FILTERS>
        <FETCH>*</FETCH>
      </COLLECTION>
      <SYSTEM TYPE="Formulae" NAME="IsSales">$VoucherTypeName = "Sales"</SYSTEM>
    </TDLMESSAGE></TDL>
  </DESC>
</BODY>
</ENVELOPE>`;

console.log('Fetching sales vouchers from Tally...');
const resp = await postXmlWithRetry(cfg, xml, 60000);

// Extract first VOUCHER block
const voucherMatch = resp.match(/<VOUCHER[\s\S]*?<\/VOUCHER>/i);
if (!voucherMatch) {
  console.log('No VOUCHER block found in response.');
  console.log('Raw response (first 2000 chars):\n', resp.slice(0, 2000));
} else {
  console.log('\n=== FIRST VOUCHER BLOCK (all fields) ===\n');
  // Print all tags and values — look for ORDER, REFERENCE, DISPATCH fields
  const lines = voucherMatch[0].split('\n');
  const relevant = lines.filter(l =>
    /ORDER|REFERENCE|DISPATCH|BUYER|SHIP|BASIC|PARTY|DATE|NARRATION/i.test(l)
  );
  console.log('Relevant fields:\n', relevant.join('\n'));
  console.log('\n\nFull first voucher block:\n', voucherMatch[0].slice(0, 3000));
}

await mongoose.disconnect();
