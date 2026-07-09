/**
 * check-invoice-tally-voucher.js
 * Shows the exact stored tallyVoucher for the first few pending invoices,
 * and also shows what serializeTallyVoucher would generate from them.
 * Run: node scripts/check-invoice-tally-voucher.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
console.log('Connected\n');

const invoices = await Invoice.find({
  status:    { $nin: ['Cancelled'] },
  source:    { $nin: ['Tally', 'tally'] },
  tallySync: { $ne: true },
}).limit(5).lean();

console.log(`Pending invoices: ${invoices.length}\n`);

for (const inv of invoices) {
  console.log(`=== ${inv.invoiceNo} | ${inv.partyName} | ₹${inv.grandTotal} ===`);
  console.log(`  tallyVoucher exists: ${!!inv.tallyVoucher}`);
  console.log(`  tallyVoucher.voucherNumber: ${inv.tallyVoucher?.voucherNumber || '(none)'}`);

  if (inv.tallyVoucher) {
    const tv = inv.tallyVoucher;
    console.log(`  date: ${tv.date}`);
    console.log(`  allLedgerEntries (${(tv.allLedgerEntries||[]).length}):`);
    for (const e of tv.allLedgerEntries || []) {
      console.log(`    ledger="${e.ledgerName}" amount=${e.amount} deemed=${e.isDeemedPositive}`);
    }
    console.log(`  allInventoryEntries (${(tv.allInventoryEntries||[]).length}):`);
    for (const e of tv.allInventoryEntries || []) {
      const acct = e.accountingAllocations?.[0]?.ledgerName || '(none)';
      console.log(`    item="${e.stockItemName}" amount=${e.amount} acctLedger="${acct}" gstLedger="${e.gstLedgerSource}"`);
    }
  } else {
    console.log('  → NO tallyVoucher — will use legacy mapper path');
    console.log(`  items: ${(inv.items||[]).map(i => `"${i.description||i.name}" tallySalesLedger="${i.tallySalesLedger||''}"`).join(', ')}`);
  }

  // Show what WOULD be sent
  const cgst = +(inv.cgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0));
  const sgst = +(inv.sgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0));
  const igst = +(inv.igstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0));
  const gt   = +(inv.grandTotal || inv.totalAmount || 0);
  console.log(`  amounts: gt=${gt} cgst=${cgst} sgst=${sgst} igst=${igst} base=${+(gt-cgst-sgst-igst).toFixed(2)}`);
  console.log('');
}

await mongoose.disconnect();
process.exit(0);
