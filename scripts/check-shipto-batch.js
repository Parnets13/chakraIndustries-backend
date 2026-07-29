import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

// Get latest 20 invoices
const invoices = await Invoice.find({})
  .sort({ createdAt: -1 })
  .limit(20)
  .lean();

console.log(`\n=== LATEST ${invoices.length} INVOICES - SHIPTO ANALYSIS ===\n`);
for (const inv of invoices) {
  const tv = inv.tallyVoucher;
  console.log(`Invoice: ${inv.invoiceNo}`);
  console.log(`  DB shipToName   : "${inv.shipToName || ''}"`);
  console.log(`  DB shipToState  : "${inv.shipToState || ''}"`);
  console.log(`  DB shipToAddress: "${(inv.shipToAddress||'').substring(0,60)}"`);
  console.log(`  DB billToState  : "${inv.billToState || ''}"`);
  console.log(`  DB partyState   : "${inv.partyState || ''}"`);
  if (tv) {
    console.log(`  TV shipToName   : "${tv.shipToName || ''}"`);
    console.log(`  TV shipToState  : "${tv.shipToState || ''}"`);
    console.log(`  TV shipToAddress: "${(tv.shipToAddress||'').substring(0,60)}"`);
  } else {
    console.log(`  TV: NULL`);
  }
  console.log('');
}

await mongoose.disconnect();
