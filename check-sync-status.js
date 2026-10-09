// check-sync-status.js — READ ONLY. Shows how many invoices synced to Tally vs pending.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import Invoice from './models/Invoice.js';

async function main() {
  await connectDB();

  const total   = await Invoice.countDocuments({ status: { $nin: ['Cancelled'] } });
  const synced  = await Invoice.countDocuments({ status: { $nin: ['Cancelled'] }, tallySync: true });
  const pending = await Invoice.countDocuments({ status: { $nin: ['Cancelled'] }, tallySync: { $ne: true } });
  const withGuid = await Invoice.countDocuments({ tallyGuid: { $exists: true, $ne: null, $ne: '' } });

  console.log('════════════════════════════════════════════');
  console.log(`  Total invoices (not cancelled): ${total}`);
  console.log(`  Synced to Tally (tallySync=true): ${synced}`);
  console.log(`  Pending (not yet synced):         ${pending}`);
  console.log(`  Have Tally GUID (confirmed in Tally): ${withGuid}`);
  console.log('════════════════════════════════════════════\n');

  // Show the most recent 99 and their individual sync state
  const recent = await Invoice.find({ status: { $nin: ['Cancelled'] } })
    .sort({ createdAt: -1 }).limit(99)
    .select('invoiceNo tallySync tallyGuid tallySyncError').lean();

  const syncedList  = recent.filter(i => i.tallySync);
  const pendingList = recent.filter(i => !i.tallySync);

  console.log(`Of the most recent 99:  ${syncedList.length} synced, ${pendingList.length} pending\n`);
  if (pendingList.length) {
    console.log('PENDING (need to re-export):');
    console.log('  ' + pendingList.map(i => i.invoiceNo).join(', '));
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
