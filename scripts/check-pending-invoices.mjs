import mongoose from 'mongoose';
import connectDB from '../config/database.js';
import Invoice from '../models/Invoice.js';

await connectDB();
const pending = await Invoice.countDocuments({ 
  tallySync: { $ne: true }, 
  source: { $nin: ['Tally'] } 
});
console.log('Pending invoices for export:', pending);

if (pending === 0) {
  console.log('\nAll invoices already exported. Creating a test invoice...');
  const existing = await Invoice.findOne({ invoiceNo: /^BIW/ }).lean();
  if (existing) {
    // Mark an existing invoice as not synced to force re-export
    await Invoice.updateOne({ invoiceNo: existing.invoiceNo }, { tallySync: false });
    console.log(`Reset ${existing.invoiceNo} for re-export test`);
  }
}
process.exit(0);
