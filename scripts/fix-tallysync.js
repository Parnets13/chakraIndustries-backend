/**
 * fix-tallysync.js
 * 
 * Checks which ERP invoices already exist as vouchers in Tally,
 * marks them tallySync=true in MongoDB, so the export skips them.
 * 
 * Run: node scripts/fix-tallysync.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import Invoice from '../models/Invoice.js';

const TALLY_URL = 'http://localhost:9000';

await mongoose.connect(process.env.MONGO_URI);
console.log('✓ Connected to MongoDB\n');

// Step 1: Fetch all existing Sales voucher numbers from Tally
console.log('Fetching existing Sales voucher numbers from Tally...');
const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ExistingVouchers</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>
    <SVCURRENTCOMPANY>SRI CHAKRA INDUSTRIES</SVCURRENTCOMPANY>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="ExistingVouchers">
      <TYPE>Voucher</TYPE>
      <FETCH>VoucherNumber, VoucherTypeName</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

const r = await axios.post(TALLY_URL, xml, {
  headers: { 'Content-Type': 'text/xml' }, timeout: 60000
});
const body = String(r.data);

// Build a Set of all voucher numbers in Tally (uppercase for case-insensitive match)
const tallyNos = new Set(
  [...body.matchAll(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/gi)]
    .map(m => m[1].trim().toUpperCase())
    .filter(Boolean)
);
console.log(`Found ${tallyNos.size} vouchers in Tally\n`);

// Step 2: Find all unsynced ERP invoices
const unsynced = await Invoice.find({ tallySync: { $ne: true } }).lean();
console.log(`Found ${unsynced.length} unsynced ERP invoices\n`);

// Step 3: Mark those that already exist in Tally
let markedCount = 0;
const toMark = [];
for (const inv of unsynced) {
  const invNo = String(inv.invoiceNo).trim().toUpperCase();
  if (tallyNos.has(invNo)) {
    toMark.push(inv._id);
    console.log(`  ✓ ${inv.invoiceNo} — already in Tally, marking synced`);
  }
}

if (toMark.length > 0) {
  const result = await Invoice.updateMany(
    { _id: { $in: toMark } },
    { tallySync: true, tallySyncAt: new Date() }
  );
  markedCount = result.modifiedCount;
  console.log(`\n✅ Marked ${markedCount} invoices as tallySync=true`);
} else {
  console.log('\nNo invoices needed marking — none found in Tally');
}

// Step 4: Show remaining unsynced
const remaining = await Invoice.countDocuments({ tallySync: { $ne: true } });
console.log(`\nRemaining unsynced invoices: ${remaining}`);

await mongoose.disconnect();
console.log('\nDone.');
