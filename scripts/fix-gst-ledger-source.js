/**
 * fix-gst-ledger-source.js
 * 
 * Fixes invoices with bad gstLedgerSource values in their stored tallyVoucher.
 * Also resets tallySync flag so they re-export.
 * 
 * Problem: invoices uploaded from Excel had tallySalesLedger set to the item
 * description itself. When exported, Tally returns EXCEPTIONS=1.
 * 
 * Solution: clear bad gstLedgerSource values and force re-export.
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

  // Find all Excel-uploaded invoices that haven't synced yet
  const invoices = await Invoice.find({
    source: 'excel_upload',
    'tallyVoucher.allInventoryEntries': { $exists: true, $ne: [] }
  }).lean();

  console.log(`[fix-gst-ledger-source] Found ${invoices.length} Excel-uploaded invoices with inventory entries`);

  let fixed = 0;

  for (const inv of invoices) {
    let needsUpdate = false;
    const updatedEntries = (inv.tallyVoucher?.allInventoryEntries || []).map(item => {
      const stockName = (item.stockItemName || '').trim();
      const gstLedger = (item.gstLedgerSource || '').trim();

      // Clear if gstLedgerSource equals stockItemName OR is "Sales Accounts"
      if (gstLedger && (gstLedger === stockName || gstLedger.toLowerCase() === 'sales accounts')) {
        console.log(`  Invoice ${inv.invoiceNo}: clearing gstLedgerSource="${gstLedger}"`);
        needsUpdate = true;
        return { ...item, gstLedgerSource: '', hsnLedgerSource: '', gstSourceType: '', hsnSourceType: '' };
      }

      return item;
    });

    if (needsUpdate) {
      await Invoice.updateOne(
        { _id: inv._id },
        { 
          $set: { 
            'tallyVoucher.allInventoryEntries': updatedEntries,
            tallySync: false,  // Force re-export
            tallySyncAt: null
          } 
        }
      );
      fixed++;
    }
  }

  console.log(`[fix-gst-ledger-source] Fixed ${fixed} invoices`);
  console.log('[fix-gst-ledger-source] Done — invoices will re-export on next Tally sync');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('[fix-gst-ledger-source] ERROR:', err);
  process.exit(1);
});
