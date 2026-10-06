// reset-tally-sync.js — Resets tallySync flags on all 99 invoices
// so they can be re-exported fresh to Tally.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  // Count before
  const before = await Invoice.countDocuments({ status: { $nin: ['Cancelled'] }, tallySync: true });
  console.log(`Before reset: ${before} invoices marked as synced`);

  // Reset all non-cancelled invoices
  const result = await Invoice.updateMany(
    { status: { $nin: ['Cancelled'] } },
    { $set: { tallySync: false, tallySyncAt: null }, $unset: { tallyGuid: '' } }
  );

  console.log(`Reset done: ${result.modifiedCount} invoices updated`);

  // Count after
  const after = await Invoice.countDocuments({ status: { $nin: ['Cancelled'] }, tallySync: true });
  const pending = await Invoice.countDocuments({ status: { $nin: ['Cancelled'] }, tallySync: { $ne: true } });
  console.log(`After reset: synced=${after}, pending=${pending}`);
  console.log('\nAll 99 invoices are now ready for fresh export.');

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
