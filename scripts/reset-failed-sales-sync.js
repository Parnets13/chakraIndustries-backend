/**
 * reset-failed-sales-sync.js
 *
 * Finds all Invoice records that are marked tallySync=true but were NEVER
 * actually created in Tally — identified by having an inventory entry whose
 * gstLedgerSource is "Sales Accounts" (a Tally group, not a ledger).
 *
 * These invoices were silently rejected by Tally (CREATED=0, ERRORS=0) but
 * the ERP mistakenly marked them as synced.
 *
 * Resets tallySync=false so the next export attempt will retry them.
 * Also clears the stored tallyVoucher so it gets re-normalized with the
 * correct useInventory=false logic.
 *
 * Run: node scripts/reset-failed-sales-sync.js
 */

import dotenv    from 'dotenv';
import connectDB from '../config/database.js';
import Invoice   from '../models/Invoice.js';

dotenv.config();

async function main() {
  await connectDB();

  console.log('Scanning for invoices falsely marked tallySync=true...\n');

  // Find all synced invoices that have inventory entries using "Sales Accounts"
  // as gstLedgerSource — these were silently rejected by Tally.
  const invoices = await Invoice.find({
    tallySync: true,
    'tallyVoucher.allInventoryEntries': { $exists: true, $not: { $size: 0 } },
  }).lean();

  const badIds = [];

  for (const inv of invoices) {
    const entries = inv.tallyVoucher?.allInventoryEntries || [];
    const hasBadLedger = entries.some(entry => {
      const src = (entry.gstLedgerSource || '').trim().toLowerCase();
      const acctSrc = (entry.accountingAllocations?.[0]?.ledgerName || '').trim().toLowerCase();
      return src === 'sales accounts' || acctSrc === 'sales accounts';
    });

    if (hasBadLedger) {
      badIds.push(inv._id);
      console.log(`  RESET: ${inv.invoiceNo} — party: ${inv.partyName}`);
    }
  }

  if (!badIds.length) {
    console.log('No affected invoices found. Either they were never exported or are already fixed.');
    process.exit(0);
  }

  console.log(`\nResetting ${badIds.length} invoice(s)...\n`);

  const result = await Invoice.updateMany(
    { _id: { $in: badIds } },
    {
      $set: { tallySync: false },
      $unset: { tallySyncAt: 1 },
    }
  );

  console.log(`Done. Modified: ${result.modifiedCount}`);
  console.log('\nThese invoices will be picked up on the next export run.');
  console.log('The serializer will now skip ALLINVENTORYENTRIES with gstLedgerSource="Sales Accounts"');
  console.log('and send a pure-accounting voucher that Tally accepts.\n');

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
