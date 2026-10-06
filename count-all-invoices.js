// count-all-invoices.js — READ ONLY. Counts ALL invoices by every status.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  const grandTotal = await Invoice.countDocuments({});
  console.log(`TOTAL invoices in DB (any status): ${grandTotal}`);

  const byStatus = await Invoice.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  console.log('\nBreakdown by status:');
  byStatus.forEach(s => console.log(`  ${s._id || '(no status)'}: ${s.count}`));

  // Any BIW invoices left?
  const biw = await Invoice.countDocuments({ invoiceNo: /^BIW/ });
  console.log(`\nBIW* invoices remaining: ${biw}`);

  const recent = await Invoice.find({}).sort({ createdAt: -1 }).limit(5).select('invoiceNo status createdAt').lean();
  console.log('\nMost recent 5 invoices (any status):');
  recent.forEach(i => console.log(`  ${i.invoiceNo} status=${i.status} created=${new Date(i.createdAt).toISOString().slice(0,19)}`));

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
