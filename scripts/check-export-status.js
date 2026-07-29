import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

const total = await Invoice.countDocuments({ source: 'excel_upload' });
const synced = await Invoice.countDocuments({ source: 'excel_upload', tallySync: true });
const pending = await Invoice.countDocuments({ source: 'excel_upload', tallySync: { $ne: true } });
const failed = await Invoice.countDocuments({ source: 'excel_upload', retryCount: { $gte: 3 } });

console.log('Total invoices:', total);
console.log('Synced:', synced);
console.log('Pending:', pending);
console.log('Failed (retryCount>=3):', failed);

// Show first 5 pending
const pendingInvs = await Invoice.find({ source: 'excel_upload', tallySync: { $ne: true } })
  .limit(5).lean();
for (const inv of pendingInvs) {
  console.log(`\n${inv.invoiceNo}: retryCount=${inv.retryCount||0} tallySync=${inv.tallySync}`);
  console.log('  shipToName:', inv.shipToName);
  console.log('  shipToState:', inv.shipToState);
  const tv = inv.tallyVoucher;
  if (tv) {
    console.log('  tv.shipToState:', tv.shipToState);
    console.log('  tv.shipToName:', tv.shipToName);
  } else {
    console.log('  tallyVoucher: NULL');
  }
}

await mongoose.disconnect();
