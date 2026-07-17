/**
 * inspect-invoice-voucher.js
 * 
 * Inspect what's stored in tallyVoucher for failing invoices
 */

import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/chakra-industries';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('[inspect] Connected to MongoDB');

  // Find one invoice that's pending export
  const inv = await Invoice.findOne({ 
    tallySync: { $ne: true },
    'tallyVoucher': { $exists: true }
  }).lean();

  if (!inv) {
    console.log('[inspect] No pending invoices found with tallyVoucher');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`\n[inspect] Invoice: ${inv.invoiceNo}`);
  console.log(`Party: ${inv.partyName}`);
  console.log(`Grand Total: ${inv.grandTotal}`);
  console.log(`\ntallyVoucher.allLedgerEntries:`);
  
  (inv.tallyVoucher?.allLedgerEntries || []).forEach((e, i) => {
    console.log(`  [${i}] ${e.ledgerName} — amount: ${e.amount}, isDeemedPositive: ${e.isDeemedPositive}`);
  });

  console.log(`\ntallyVoucher.allInventoryEntries:`);
  (inv.tallyVoucher?.allInventoryEntries || []).forEach((e, i) => {
    console.log(`  [${i}] stockItemName: "${e.stockItemName}"`);
    console.log(`      gstLedgerSource: "${e.gstLedgerSource || '(empty)'}"`);
    console.log(`      hsnLedgerSource: "${e.hsnLedgerSource || '(empty)'}"`);
    console.log(`      amount: ${e.amount}`);
    console.log(`      accountingAllocations[0]?.ledgerName: "${e.accountingAllocations?.[0]?.ledgerName || '(none)'}"`);
  });

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('[inspect] ERROR:', err);
  process.exit(1);
});
