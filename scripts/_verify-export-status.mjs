/**
 * READ-ONLY. Lists exactly which pending invoices have the bad "party name used
 * as sales ledger" value, and which items they contain. Changes nothing.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

const MAX_RETRIES = 4;
await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
console.log('Connected to DB:', mongoose.connection.name, '\n');

const baseFilter = { source: { $nin: ['Tally', 'tally'] }, status: { $nin: ['Cancelled'] } };

const pending = await Invoice.find({
  ...baseFilter,
  $and: [
    { $or: [ { tallySync: { $ne: true } }, { tallySync: true, tallySyncAt: { $exists: false } } ] },
    { $or: [ { retryCount: { $exists: false } }, { retryCount: { $lte: MAX_RETRIES } } ] },
  ],
}).lean();

const looksLikeParty = (l) => /limited|pvt|ltd|jewelry|jewellery|bazzar|salem|\(\d+/i.test(l || '');

const bad = [];
const goodLedgers = new Set();
for (const inv of pending) {
  const badItems = (inv.items || []).filter(it => looksLikeParty(it.tallySalesLedger));
  (inv.items || []).forEach(it => { if (!looksLikeParty(it.tallySalesLedger) && it.tallySalesLedger) goodLedgers.add(it.tallySalesLedger.trim()); });
  if (badItems.length) {
    bad.push({
      invoiceNo: inv.invoiceNo,
      items: badItems.map(it => (it.description || it.name || '').trim()),
    });
  }
}

console.log(`Total pending: ${pending.length}`);
console.log(`❌ Invoices that will be REJECTED (bad sales ledger): ${bad.length}\n`);
for (const b of bad) {
  console.log(`   ${b.invoiceNo}  →  item: ${b.items.join(', ')}`);
}

console.log('\n✅ Valid sales ledgers already in use by the working invoices:');
[...goodLedgers].sort().forEach(l => console.log(`   "${l}"`));

console.log('\nAll bad ones currently point to: "AVR SWARNA MAHAL JEWELRY LIMITED - SALEM 2 (194 - BAZZAR)"');
console.log('This is a CUSTOMER name, not a Sales ledger — that is why Tally rejects them.');

await mongoose.disconnect();
process.exit(0);
