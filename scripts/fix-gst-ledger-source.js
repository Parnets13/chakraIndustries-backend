/**
 * fix-gst-ledger-source.js
 * 
 * Fixes invoices with bad gstLedgerSource values in their stored tallyVoucher.
 * 
 * Problem: invoices uploaded from Excel had tallySalesLedger set to the item
 * description itself (e.g. "HYDRA STEEL WATER BOTTLE 1000ML"). This was then
 * stored as gstLedgerSource in the tallyVoucher sub-document. When exported,
 * Tally sees a stock item name as GSTLEDGERSOURCE and returns EXCEPTIONS=1.
 * 
 * Solution: clear gstLedgerSource/hsnLedgerSource when they equal the stockItemName.
 */

import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/chakra-industries';

async function main() {
  console.log('[fix-gst-ledger-source] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[fix-gst-ledger-source] Connected');

  // Find all invoices that have a tallyVoucher with inventory entries
  const invoices = await Invoice.find({
    'tallyVoucher.allInventoryEntries': { $exists: true, $ne: [] }
  }).lean();

  console.log(`[fix-gst-ledger-source] Found ${invoices.length} invoices with inventory entries`);

  let fixed = 0;

  for (const inv of invoices) {
    let needsUpdate = false;
    const updatedEntries = (inv.tallyVoucher?.allInventoryEntries || []).map(item => {
      const stockName = (item.stockItemName || '').trim();
      const gstLedger = (item.gstLedgerSource || '').trim();
      const hsnLedger = (item.hsnLedgerSource || '').trim();

      // Clear if gstLedgerSource equals stockItemName (item name used as ledger = wrong)
      if (gstLedger && gstLedger === stockName) {
        console.log(`  Invoice ${inv.invoiceNo}: clearing gstLedgerSource="${gstLedger}" (equals stockItemName)`);
        needsUpdate = true;
        return { ...item, gstLedgerSource: '', hsnLedgerSource: '' };
      }

      // Also clear if it's "Sales Accounts" (group name, not a ledger)
      if (gstLedger && gstLedger.toLowerCase() === 'sales accounts') {
        console.log(`  Invoice ${inv.invoiceNo}: clearing gstLedgerSource="Sales Accounts" (group, not ledger)`);
        needsUpdate = true;
        return { ...item, gstLedgerSource: '', hsnLedgerSource: '' };
      }

      return item;
    });

    if (needsUpdate) {
      await Invoice.updateOne(
        { _id: inv._id },
        { $set: { 'tallyVoucher.allInventoryEntries': updatedEntries } }
      );
      fixed++;
    }
  }

  console.log(`[fix-gst-ledger-source] Fixed ${fixed} invoices`);
  console.log('[fix-gst-ledger-source] Done');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('[fix-gst-ledger-source] ERROR:', err);
  process.exit(1);
});
