/**
 * force-fresh-export.js
 * Clears tallySync AND tallyGuid so vouchers export as fresh CREATE (not Alter).
 * Run AFTER deleting the vouchers from Tally manually.
 * node scripts/force-fresh-export.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);

const result = await Invoice.updateMany(
  { source: { $nin: ['Tally', 'tally'] }, status: { $nin: ['Cancelled'] } },
  { $unset: { tallySync: 1, tallySyncAt: 1, tallyGuid: 1 }, $set: { retryCount: 0 } }
);

console.log(`✅ Force-reset ${result.modifiedCount} invoices — will export as fresh CREATE`);
await mongoose.disconnect();
