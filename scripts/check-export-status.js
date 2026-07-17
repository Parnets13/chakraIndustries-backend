import 'dotenv/config';
import mongoose from 'mongoose';
import TallySyncLog from '../models/TallySyncLog.js';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);

// Recent Sales export logs
const logs = await TallySyncLog.find({ type: 'Sales' }).sort({ createdAt: -1 }).limit(15).lean();
console.log('=== Recent Sales export logs ===');
if (!logs.length) {
  console.log('  No Sales sync logs found at all.');
} else {
  logs.forEach(l => console.log(
    new Date(l.createdAt).toLocaleString('en-IN'),
    '|', l.status,
    '| records:', l.records,
    '| error:', (l.error || 'none').slice(0, 100)
  ));
}

// Invoice tallySync breakdown
const synced   = await Invoice.countDocuments({ tallySync: true });
const pending  = await Invoice.find({ tallySync: { $ne: true }, source: { $nin: ['Tally','tally'] }, status: { $nin: ['Cancelled'] } }).lean();

console.log('\n=== Invoice tallySync status ===');
console.log('  tallySync=true  (marked as exported):', synced);
console.log('  tallySync=false (pending, never sent):', pending.length);

if (pending.length > 0) {
  console.log('\nPending invoices (BIW series + others):');
  pending.forEach(inv => console.log(
    ' ', inv.invoiceNo,
    '| party:', inv.partyName,
    '| amount: ₹' + inv.grandTotal,
    '| tallySync:', inv.tallySync,
    '| tallySyncAt:', inv.tallySyncAt || 'never'
  ));
}

await mongoose.disconnect();
