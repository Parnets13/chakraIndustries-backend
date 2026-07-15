/**
 * check-biw-in-tally.js
 * Checks if BIW11-BIW20 vouchers already exist in Tally
 */
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import TallyConfig from '../models/TallyConfig.js';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}).lean();

const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>BIWVouchers</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>
    <SVCURRENTCOMPANY>SRI CHAKRA INDUSTRIES</SVCURRENTCOMPANY>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVFROMDATE>20260701</SVFROMDATE>
    <SVTODATE>20260731</SVTODATE>
  </STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="BIWVouchers">
      <TYPE>Voucher</TYPE>
      <FETCH>VoucherNumber, Date, VoucherTypeName, PartyLedgerName, Amount</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

const resp = await postXmlWithRetry(cfg, xml, 30000, 1);

// Extract voucher numbers
const voucherMatches = [...resp.matchAll(/<VOUCHERNUMBER[^>]*>(.*?)<\/VOUCHERNUMBER>/gi)];
const dateMatches = [...resp.matchAll(/<DATE[^>]*>(.*?)<\/DATE>/gi)];

console.log(`\nVouchers in Tally for July 2026 (${voucherMatches.length} found):`);
for (let i = 0; i < voucherMatches.length; i++) {
  const vno = voucherMatches[i][1];
  const dt = dateMatches[i]?.[1] || '?';
  if (/BIW/i.test(vno)) {
    console.log(`  *** BIW: ${vno} | date: ${dt}`);
  } else {
    console.log(`  ${vno} | date: ${dt}`);
  }
}

await mongoose.disconnect();
