// check-guid-detail.js — READ ONLY. Shows tallySync vs tallyGuid in detail
// to tell whether "synced" invoices actually got confirmed by Tally.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  const recent = await Invoice.find({ status: { $nin: ['Cancelled'] } })
    .sort({ createdAt: -1 }).limit(99)
    .select('invoiceNo tallySync tallyGuid invoiceDate createdAt').lean();

  const syncedWithGuid    = recent.filter(i => i.tallySync && i.tallyGuid);
  const syncedNoGuid      = recent.filter(i => i.tallySync && !i.tallyGuid);
  const notSynced         = recent.filter(i => !i.tallySync);

  console.log('════════════════════════════════════════════');
  console.log(`  tallySync=true AND has tallyGuid: ${syncedWithGuid.length}`);
  console.log(`  tallySync=true BUT no tallyGuid:  ${syncedNoGuid.length}`);
  console.log(`  not synced:                       ${notSynced.length}`);
  console.log('════════════════════════════════════════════\n');

  // Show invoice date range — maybe they went to a different Tally period
  const dates = recent.map(i => (i.invoiceDate || '').toString().slice(0,10)).filter(Boolean).sort();
  console.log(`Invoice date range: ${dates[0]}  →  ${dates[dates.length-1]}`);
  console.log(`(If Tally's open period doesn't cover these dates, vouchers import but`);
  console.log(` are not visible in the current period view.)\n`);

  console.log('Sample of synced invoices (first 10) with their date:');
  syncedWithGuid.concat(syncedNoGuid).slice(0, 10).forEach(i => {
    console.log(`  ${i.invoiceNo}  date=${(i.invoiceDate||'').toString().slice(0,10)}  guid=${i.tallyGuid ? 'YES' : 'NO'}`);
  });

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
