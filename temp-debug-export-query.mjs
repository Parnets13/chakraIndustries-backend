import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
console.log('MONGO_URI=' + (uri ? uri.slice(0, 80) : '<missing>'));
await mongoose.connect(uri, { connectTimeoutMS: 10000 });
const statusQuery = { tallySync: { $ne: true }, source: { $nin: ['Tally','tally'] }, status: { $nin: ['Cancelled'] } };
const exportQuery = { status: { $nin: ['Cancelled'] }, source: { $nin: ['Tally','tally'] }, $and: [ { $or: [ { tallySync: { $ne: true } }, { tallySync: true, tallySyncAt: { $exists: false } } ] }, { $or: [ { retryCount: { $exists: false } }, { retryCount: { $lt: 3 } } ] } ] };
const statusCount = await Invoice.countDocuments(statusQuery);
const exportCount = await Invoice.countDocuments(exportQuery);
const statusSample = await Invoice.find(statusQuery).limit(10).lean();
const exportSample = await Invoice.find(exportQuery).limit(10).lean();
console.log('statusCount=' + statusCount);
console.log('exportCount=' + exportCount);
console.log('statusSample=' + JSON.stringify(statusSample.map(i => ({ invoiceNo:i.invoiceNo, tallySync:i.tallySync, retryCount:i.retryCount, tallySyncAt:i.tallySyncAt, source:i.source })), null, 2));
console.log('exportSample=' + JSON.stringify(exportSample.map(i => ({ invoiceNo:i.invoiceNo, tallySync:i.tallySync, retryCount:i.retryCount, tallySyncAt:i.tallySyncAt, source:i.source })), null, 2));
await mongoose.disconnect();
