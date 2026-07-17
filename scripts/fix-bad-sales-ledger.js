/**
 * fix-bad-sales-ledger.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fixes the "Ledger 'Sales' does not exist!" Tally export failure.
 *
 * Actions:
 *   1. Clears bad tallySalesLedger values from ItemMaster (e.g., "Sales" → "")
 *   2. Re-normalizes affected Invoice.tallyVoucher sub-documents
 *   3. Clears tallySync flag on affected invoices so they re-export
 *
 * Run:
 *   node scripts/fix-bad-sales-ledger.js
 *
 * Safe to run multiple times — idempotent.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import ItemMaster from '../models/ItemMaster.js';
import Invoice    from '../models/Invoice.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ Connected to MongoDB\n');

// ── Tally group/voucher-type names that are NOT valid ledger names ─────────────
const INVALID_LEDGER_NAMES = [
  'sales', 'purchase', 'vouchers', 'journal', 'contra', 'receipt', 'payment',
  'debit note', 'credit note', 'stock journal',
];

// ── STEP 1: Fix ItemMaster.tallySalesLedger ────────────────────────────────────
console.log('=== STEP 1: Fixing bad ItemMaster.tallySalesLedger values ===');
const allMasters = await ItemMaster.find(
  { tallySalesLedger: { $exists: true, $ne: '' } }
).lean();

const badMasters = allMasters.filter(m => {
  const v = (m.tallySalesLedger || '').trim().toLowerCase();
  return INVALID_LEDGER_NAMES.includes(v);
});

if (badMasters.length === 0) {
  console.log('✅ No bad ItemMaster.tallySalesLedger values found\n');
} else {
  console.log(`Found ${badMasters.length} ItemMaster record(s) with bad tallySalesLedger`);
  for (const m of badMasters) {
    console.log(`   "${m.name}": "${m.tallySalesLedger}" → cleared`);
    await ItemMaster.updateOne({ _id: m._id }, { $set: { tallySalesLedger: '' } });
  }
  console.log(`✅ Cleared ${badMasters.length} ItemMaster record(s)\n`);
}

// ── STEP 2: Re-normalize affected invoices ────────────────────────────────────
console.log('=== STEP 2: Re-normalizing affected invoices ===');
const cfg = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
const periodEnd = cfg?.tallyPeriodEnd || null;

// Find all pending invoices that have stored tallyVoucher
const allPending = await Invoice.find({
  status:    { $nin: ['Cancelled'] },
  source:    { $nin: ['Tally', 'tally'] },
  'tallyVoucher': { $ne: null },
}).lean();

console.log(`Checking ${allPending.length} pending invoices with tallyVoucher...`);

const badInvoices = [];
for (const inv of allPending) {
  if (!inv.tallyVoucher) continue;
  const tv = inv.tallyVoucher;

  // Check allLedgerEntries for bad ledger names
  const hasBadLedgerEntry = (tv.allLedgerEntries || []).some(e => {
    const v = (e.ledgerName || '').trim().toLowerCase();
    return INVALID_LEDGER_NAMES.includes(v);
  });

  // Check allInventoryEntries for bad gstLedgerSource or accountingAllocations
  const hasBadInventoryEntry = (tv.allInventoryEntries || []).some(e => {
    const src = (e.gstLedgerSource || '').trim().toLowerCase();
    const hasInvalidSrc = INVALID_LEDGER_NAMES.includes(src);
    const hasInvalidAA = (e.accountingAllocations || []).some(a =>
      INVALID_LEDGER_NAMES.includes((a.ledgerName || '').trim().toLowerCase())
    );
    return hasInvalidSrc || hasInvalidAA;
  });

  if (hasBadLedgerEntry || hasBadInventoryEntry) {
    badInvoices.push(inv);
  }
}

if (badInvoices.length === 0) {
  console.log('✅ No invoices with bad ledger names in tallyVoucher\n');
} else {
  console.log(`Found ${badInvoices.length} invoice(s) with bad ledger names\n`);
  
  let successCount = 0;
  let failCount = 0;

  for (const inv of badInvoices) {
    try {
      console.log(`   Re-normalizing ${inv.invoiceNo}...`);
      
      // Re-normalize the invoice from scratch
      // The bad ItemMaster.tallySalesLedger has been cleared, so normalizeToTallyVoucher
      // will now use the fallback 'Sales Accounts' or compute the correct ledger name
      const newTallyVoucher = normalizeToTallyVoucher(inv, { periodEnd });
      
      // Update the invoice with the new tallyVoucher, and clear tallySync
      // so it will be re-exported on the next export run
      await Invoice.updateOne(
        { _id: inv._id },
        {
          $set: {
            tallyVoucher: newTallyVoucher,
            tallySync: false,
          },
          $unset: { tallySyncAt: '' },
        }
      );
      
      successCount++;
      console.log(`      ✅ Fixed`);
    } catch (err) {
      failCount++;
      console.error(`      ❌ Failed: ${err.message}`);
    }
  }

  console.log(`\n✅ Re-normalized ${successCount} invoice(s)`);
  if (failCount > 0) {
    console.log(`❌ Failed to re-normalize ${failCount} invoice(s) — check logs above`);
  }
}

// ── STEP 3: Summary ────────────────────────────────────────────────────────────
console.log('\n=== SUMMARY ===');
console.log(`ItemMaster records fixed   : ${badMasters.length}`);
console.log(`Invoices re-normalized     : ${badInvoices.length}`);
console.log('\n→ The export should now work. Try exporting again.');
console.log('→ If it still fails, run diagnose-bad-sales-ledger.js to see what remains.\n');

await mongoose.disconnect();
process.exit(0);
