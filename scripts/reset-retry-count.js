import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

const result = await Invoice.updateMany(
  { source: 'excel_upload' },
  { $set: { retryCount: 0, tallySync: false, tallyGuid: '' } }
);

console.log(`Reset ${result.modifiedCount} invoices — retryCount=0, tallySync=false, tallyGuid=''`);
await mongoose.disconnect();
