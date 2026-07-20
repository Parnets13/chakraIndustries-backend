import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);

const pending = await Invoice.countDocuments({ tallySync: { $ne: true }, status: { $nin: ['Cancelled'] }, source: { $nin: ['Tally','tally'] } });
const synced  = await Invoice.countDocuments({ tallySync: true, source: { $nin: ['Tally','tally'] } });

console.log('Pending (will export on next run):', pending);
console.log('Synced  (already in Tally - need reset):', synced);

// Show the 5 most recent invoices
const recent = await Invoice.find({ source: { $nin: ['Tally','tally'] }, status: { $nin: ['Cancelled'] } })
  .sort({ createdAt: -1 }).limit(5).lean();

console.log('\nRecent 5 invoices:');
for (const inv of recent) {
  console.log(`  ${inv.invoiceNo} | tallySync=${inv.tallySync} | tallySyncAt=${inv.tallySyncAt || 'none'}`);
}

await mongoose.disconnect();
