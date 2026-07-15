import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

async function main() {
  const uri = process.env.MONGO_URI;
  console.log('MONGO_URI', uri ? uri.slice(0, 40) + '...' : 'undefined');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });

  const total = await Invoice.countDocuments({});
  const tallySource = await Invoice.countDocuments({ source: { $in: ['Tally', 'tally'] } });
  const nonTallyTotal = await Invoice.countDocuments({ source: { $nin: ['Tally', 'tally'] } });
  const nonTallyActive = await Invoice.countDocuments({ source: { $nin: ['Tally', 'tally'] }, status: { $nin: ['Cancelled'] } });
  const pendingExport = await Invoice.countDocuments({
    status: { $nin: ['Cancelled'] },
    source: { $nin: ['Tally', 'tally'] },
    $and: [
      { $or: [ { tallySync: { $ne: true } }, { tallySync: true, tallySyncAt: { $exists: false } } ] },
      { $or: [ { retryCount: { $exists: false } }, { retryCount: { $lt: 3 } } ] }
    ]
  });

  console.log('total:', total);
  console.log('source Tally:', tallySource);
  console.log('source non-Tally:', nonTallyTotal);
  console.log('source non-Tally + active:', nonTallyActive);
  console.log('pending export by query:', pendingExport);

  const breakdown = await Invoice.aggregate([
    { $group: { _id: { source: '$source', status: '$status', tallySync: '$tallySync', retryCount: '$retryCount' }, count: { $sum: 1 } } },
    { $sort: { '_id.source': 1, '_id.status': 1, '_id.tallySync': 1, '_id.retryCount': 1 } }
  ]);
  console.log('\nBreakdown of invoices by source/status/tallySync/retryCount:');
  breakdown.forEach(doc => console.log(JSON.stringify(doc)));

  const nonTallySample = await Invoice.find({ source: { $nin: ['Tally', 'tally'] } }).sort({ createdAt: -1 }).limit(20).lean();
  console.log('\nRecent non-Tally invoices:');
  nonTallySample.forEach(inv => {
    console.log(inv.invoiceNo, '|', inv.status, '|', inv.source, '| tallySync=', inv.tallySync, '| retryCount=', inv.retryCount, '| tallySyncAt=', inv.tallySyncAt ? inv.tallySyncAt.toISOString().slice(0, 10) : 'null');
  });

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
