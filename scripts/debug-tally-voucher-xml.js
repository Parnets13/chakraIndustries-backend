/**
 * Fetches ONE sales voucher directly from Tally and shows what address
 * fields Tally actually returns in the XML response.
 * This tells us definitively whether the data exists in Tally or not.
 */
import connectDB from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';
import TallyVoucher from '../models/TallyVoucher.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import mongoose from 'mongoose';

await connectDB();

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const co    = (cfg.companyName || '').trim().toUpperCase();
const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';

// Get a recent Sales voucher number from MongoDB
const sample = await TallyVoucher.findOne({ voucherType: 'Sales' })
  .sort({ createdAt: -1 }).lean();

if (!sample) { console.log('No Sales vouchers in MongoDB'); process.exit(0); }

console.log('Testing voucher:', sample.voucherNumber, '  party:', sample.partyName);

// Fetch the specific voucher from Tally by voucher number
const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SingleVoucher</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="SingleVoucher">
      <TYPE>Voucher</TYPE>
      <FILTERS>FilterByVoucherNo</FILTERS>
      <FETCH>GUID, VoucherNumber, Date, PartyLedgerName, BILLTONAME, BILLTOADDRESS, BILLTOCITY, BILLTOSTATE, BILLTOPINCODE, BILLTOGSTIN, BASICBUYERNAME, BASICBUYERADDRESS, BASICBUYERADDRESS.LIST, BUYERPINCODE, BUYERADDRESS, BUYERCITY, BUYERSTATE, CONSIGNEEPINCODE, PARTYMAILINGNAME, PARTYPINCODE</FETCH>
    </COLLECTION>
    <SYSTEM:FORMULA NAME="FilterByVoucherNo">$$IsEqual:$VoucherNumber:"${sample.voucherNumber}"</SYSTEM:FORMULA>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

console.log('\nFetching from Tally...');
try {
  const resp = await postXmlWithRetry(cfg, xml, 30000, 1);
  console.log('\n=== RAW TALLY RESPONSE (address-related tags) ===');
  const lines = resp.split(/[\r\n]+/);
  let foundAny = false;
  for (const line of lines) {
    if (line.match(/BILLTO|PINCODE|ADDRESS|BUYERNAME|BUYERCITY|BUYERSTATE|PARTYPIN|MAILINGNAME|CONSIGN/i)) {
      console.log(line.trim());
      foundAny = true;
    }
  }
  if (!foundAny) {
    console.log('NO address/pincode tags found in Tally response for this voucher.');
    console.log('\nFirst 1000 chars of response:');
    console.log(resp.substring(0, 1000));
  }
} catch (e) {
  console.error('Tally fetch failed:', e.message);
  console.log('\nTally may not be running or connected. Checking ledger master instead...');
  
  // Try fetching the party ledger directly
  const ledgerXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SingleLedger</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="SingleLedger">
      <TYPE>Ledger</TYPE>
      <FILTERS>FilterByName</FILTERS>
      <FETCH>Name, MailingName, Address, LedgerCity, LedgerState, StateName, Pincode, LedgerPincode, GSTIN, PartyGSTIN</FETCH>
    </COLLECTION>
    <SYSTEM:FORMULA NAME="FilterByName">$$IsEqual:$Name:"${sample.partyName}"</SYSTEM:FORMULA>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
  try {
    const ledgerResp = await postXmlWithRetry(cfg, ledgerXml, 30000, 1);
    console.log('\n=== LEDGER MASTER RESPONSE ===');
    console.log(ledgerResp.substring(0, 2000));
  } catch (e2) {
    console.error('Ledger fetch also failed:', e2.message);
  }
}

await mongoose.disconnect();
