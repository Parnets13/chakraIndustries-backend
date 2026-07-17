import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

async function main() {
  const uri = process.env.MONGO_URI;
  console.log('MONGO_URI', uri ? uri.slice(0, 40) + '...' : 'undefined');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const total = await Invoice.countDocuments({});
  const pending = await Invoice.countDocuments({
    status: { $nin: ['Cancelled'] },
    source: { $nin: ['Tally', 'tally'] },
    $and: [
      { $or: [ { tallySync: { $ne: true } }, { tallySync: true, tallySyncAt: { $exists: false } } ] },
      { $or: [ { retryCount: { $exists: false } }, { retryCount: { $lt: 3 } } ] }
    ]
  });
  const synced = await Invoice.countDocuments({ tallySync: true });
  const tallySource = await Invoice.countDocuments({ source: { $in: ['Tally', 'tally'] } });
  console.log('total', total, 'pendingExport', pending, 'synced', synced, 'sourceTally', tallySource);
  const recent = await Invoice.find({}).sort({ createdAt: -1 }).limit(10).lean();
  console.log('recent sample:');
  recent.forEach(inv => {
    console.log(inv.invoiceNo, inv.status, inv.source, inv.tallySync, inv.retryCount, inv.tallySyncAt ? inv.tallySyncAt.toISOString().slice(0,10) : 'null');
  });
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
