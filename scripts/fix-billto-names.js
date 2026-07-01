/**
 * fix-billto-names.js
 *
 * One-time migration: fix vouchers where billToName was incorrectly set to
 * partyName (the ship-to/consignee) instead of the actual buyer.
 *
 * Logic: If billToName === partyName AND shipToName is set AND they differ
 *        (meaning it's one of those bill-to ≠ ship-to invoices), we cannot
 *        recover the real bill-to from DB alone — we just clear the wrong value
 *        so it shows as '—' instead of showing the wrong party.
 *
 * Run: node scripts/fix-billto-names.js
 */
import dotenv from 'dotenv';
dotenv.config();
import dns from 'dns';
import mongoose from 'mongoose';

dns.setServers(['8.8.8.8', '8.8.4.4']);
await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

const TallyVoucher = (await import('../models/TallyVoucher.js')).default;

// Find Sales vouchers where billToName == partyName but shipToName is different
// These are the wrong ones — bill-to got set to the consignee instead of the buyer.
const docs = await TallyVoucher.find({
  voucherType: 'Sales',
  $expr: {
    $and: [
      { $ne: ['$billToName', ''] },
      { $ne: ['$shipToName', ''] },
      { $eq: ['$billToName', '$partyName'] },
      { $ne: ['$shipToName', '$partyName'] },
    ]
  }
}).lean();

console.log(`Found ${docs.length} vouchers with suspected wrong billToName`);

let fixed = 0;
for (const doc of docs) {
  console.log(`  Voucher: ${doc.voucherNumber} | billToName="${doc.billToName}" | shipToName="${doc.shipToName}" | partyName="${doc.partyName}"`);
  // Clear billToName — will be re-populated correctly on next import
  await TallyVoucher.updateOne({ _id: doc._id }, { $set: { billToName: '' } });
  fixed++;
}

console.log(`\nCleared billToName on ${fixed} vouchers. Re-import from Tally to get correct values.`);
await mongoose.disconnect();
