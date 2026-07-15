import "dotenv/config";
import mongoose from "mongoose";
import Invoice from "./models/Invoice.js";

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
console.log("MONGO_URI=", uri ? uri.slice(0, 100) : '<missing>');
await mongoose.connect(uri, { connectTimeoutMS: 10000 });

const sample = await Invoice.find({ status: { $nin: ['Cancelled'] }, source: { $nin: ['Tally','tally'] } }).sort({ retryCount: -1 }).limit(20).lean();
console.log('found', sample.length, 'ERP invoices');
for (const inv of sample) {
  console.log(JSON.stringify({ invoiceNo: inv.invoiceNo, tallySync: inv.tallySync, retryCount: inv.retryCount, tallySyncAt: inv.tallySyncAt, source: inv.source, invoiceDate: inv.invoiceDate, createdAt: inv.createdAt }, null, 2));
}

const exportQuery = {
  status: { $nin: ['Cancelled'] },
  source: { $nin: ['Tally','tally'] },
  $and: [
    { $or: [ { tallySync: { $ne: true } }, { tallySync: true, tallySyncAt: { $exists: false } } ] },
    { $or: [ { retryCount: { $exists: false } }, { retryCount: { $lte: 3 } } ] }
  ]
};
const count = await Invoice.countDocuments(exportQuery);
console.log('exportQueryCount=', count);
const sample2 = await Invoice.find(exportQuery).limit(20).lean();
console.log('sample export match:', sample2.map(i => ({ invoiceNo: i.invoiceNo, retryCount: i.retryCount, tallySync: i.tallySync, invoiceDate: i.invoiceDate })));
await mongoose.disconnect();
