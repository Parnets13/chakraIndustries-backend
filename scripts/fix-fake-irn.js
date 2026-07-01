/**
 * fix-fake-irn.js
 *
 * One-time migration: clear IRN values that are Tally GUIDs (UUID-like strings)
 * rather than genuine GST e-invoice IRNs (64 hex chars).
 *
 * Run: node --experimental-vm-modules scripts/fix-fake-irn.js
 * (or match whatever runner is used in this project)
 */
import dotenv from 'dotenv';
dotenv.config();
import dns from 'dns';
import mongoose from 'mongoose';

dns.setServers(['8.8.8.8', '8.8.4.4']);
await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

const TallyVoucher = (await import('../models/TallyVoucher.js')).default;

// A real GST IRN is exactly 64 lowercase hex characters.
// Anything else (UUID, GUID with dashes/slashes, short strings) is a fake.
const REAL_IRN = /^[0-9a-fA-F]{64}$/;

const docs = await TallyVoucher.find({ irn: { $exists: true, $ne: '' } }).lean();
let cleared = 0;

for (const doc of docs) {
  const irn = (doc.irn || '').trim();
  if (irn && !REAL_IRN.test(irn)) {
    await TallyVoucher.updateOne({ _id: doc._id }, { $set: { irn: '' } });
    cleared++;
    console.log(`Cleared fake IRN on ${doc.voucherNumber || doc._id}: "${irn.slice(0, 60)}..."`);
  }
}

console.log(`\nDone — cleared ${cleared} fake IRN value(s) out of ${docs.length} vouchers with irn set.`);
await mongoose.disconnect();
