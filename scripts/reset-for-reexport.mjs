/**
 * Reset BIW11-BIW20 tallySync to false so they get re-exported with fixed ship-to data.
 * Run AFTER deleting the old vouchers from Tally manually.
 */
import 'dotenv/config';
import connectDB from '../config/database.js';
import Invoice from '../models/Invoice.js';
import mongoose from 'mongoose';

await connectDB();

const invoiceNos = ['BIW11','BIW12','BIW13','BIW14','BIW15','BIW16','BIW17','BIW18','BIW19','BIW20'];

const result = await Invoice.updateMany(
  { invoiceNo: { $in: invoiceNos } },
  { $set: { tallySync: false, tallySyncAt: null, retryCount: 0 } }
);

console.log(`Reset ${result.modifiedCount} invoices to tallySync=false`);
console.log('Now delete BIW11-BIW20 from Tally, then trigger re-export.');

await mongoose.disconnect();
process.exit(0);
