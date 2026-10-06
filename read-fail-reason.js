// read-fail-reason.js — READ ONLY. Shows the exact lastError Tally returned
// for each of the 20 failed invoices (saved by exportSalesInvoices).
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  const failed = await Invoice.find({
    status: { $nin: ['Cancelled'] },
    tallySync: { $ne: true }
  }).select('invoiceNo lastError retryCount lastTriedAt').lean();

  console.log(`Found ${failed.length} not-synced invoices.\n`);

  // Group by the distinct error message
  const byError = new Map();
  failed.forEach(f => {
    const key = (f.lastError || '(no lastError saved)').trim();
    if (!byError.has(key)) byError.set(key, []);
    byError.get(key).push(f.invoiceNo);
  });

  console.log('═══ FAILURE REASONS (grouped) ═══\n');
  for (const [err, list] of byError) {
    console.log(`REASON: ${err}`);
    console.log(`  Count: ${list.length}`);
    console.log(`  Invoices: ${list.join(', ')}`);
    console.log(`  Last tried: ${failed.find(f => list.includes(f.invoiceNo))?.lastTriedAt || 'n/a'}`);
    console.log('');
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
