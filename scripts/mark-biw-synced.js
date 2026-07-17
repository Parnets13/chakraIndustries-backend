/**
 * mark-biw-synced.js
 * 
 * Marks BIW11–BIW20 invoices as tallySync=true so the export skips them.
 * Use this when the vouchers already exist in Tally and you just need to
 * stop the repeated "Voucher date is missing" errors.
 * 
 * Usage: node scripts/mark-biw-synced.js
 */
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

const invoiceNos = ['BIW11','BIW12','BIW13','BIW14','BIW15','BIW16','BIW17','BIW18','BIW19','BIW20'];

const result = await Invoice.updateMany(
  { invoiceNo: { $in: invoiceNos } },
  { 
    $set: { 
      tallySync: true,
      tallySyncAt: new Date(),
      tallySyncNote: 'Manually marked synced - voucher already exists in Tally'
    }
  }
);

console.log(`Updated ${result.modifiedCount} invoices as tallySync=true`);

// Show current state
const invoices = await Invoice.find({ invoiceNo: { $in: invoiceNos } }, 'invoiceNo tallySync tallySyncAt').lean();
for (const inv of invoices) {
  console.log(`  ${inv.invoiceNo}: tallySync=${inv.tallySync}`);
}

await mongoose.disconnect();
console.log('Done.');
