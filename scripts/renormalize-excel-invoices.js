/**
 * renormalize-excel-invoices.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Re-runs normalizeToTallyVoucher on every Excel-uploaded invoice so that the
 * new fields (shipToName, shipToAddress, poDate, billToName, billToGST, and
 * ALLINVENTORYENTRIES with item names) are written into the stored tallyVoucher
 * sub-document.
 *
 * Run ONCE after deploying the fix:
 *   node scripts/renormalize-excel-invoices.js
 *
 * Safe to re-run — it only updates invoices where source='excel_upload'.
 * Does NOT touch Tally-imported invoices or manual invoices.
 * Does NOT reset tallySync — already-exported invoices will be re-exported
 * on the next export run with the corrected fields.
 */

import dotenv       from 'dotenv';
import connectDB    from '../config/database.js';
import Invoice      from '../models/Invoice.js';
import ItemMaster   from '../models/ItemMaster.js';
import TallyConfig  from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

dotenv.config();

const BATCH_SIZE = 50; // process N invoices at a time

// ── helpers ───────────────────────────────────────────────────────────────────
function pad(n, w = 4) { return String(n).padStart(w, ' '); }

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Re-normalize Excel-uploaded invoices → rebuild tallyVoucher');
  console.log(' Adds: shipToName, shipToAddress, poDate, billToName, billToGST,');
  console.log('       ALLINVENTORYENTRIES (item names) when ItemMaster has ledger');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await connectDB();

  // Fetch Tally period end once
  const cfg       = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
  const periodEnd = cfg?.tallyPeriodEnd || null;
  console.log(`\nTally period end : ${periodEnd || '(not set — no date capping)'}`);

  // Count target invoices
  const total = await Invoice.countDocuments({ source: 'excel_upload' });
  console.log(`Target invoices  : ${total} (source=excel_upload)\n`);

  if (!total) {
    console.log('✅ No Excel-uploaded invoices found — nothing to do.');
    process.exit(0);
  }

  // Pre-fetch ALL ItemMaster records once — avoids N DB queries
  const allMasters = await ItemMaster.find({}, 'name hsn tallySalesLedger').lean();
  const masterMap  = new Map(allMasters.map(m => [m.name, m]));
  console.log(`ItemMaster cache : ${allMasters.length} items loaded`);
  console.log('');

  let processed = 0, updated = 0, skipped = 0, failed = 0;
  let cursor = 0;

  while (cursor < total) {
    const batch = await Invoice.find({ source: 'excel_upload' })
      .sort({ createdAt: 1 })
      .skip(cursor)
      .limit(BATCH_SIZE)
      .lean();

    if (!batch.length) break;

    const ops = [];

    for (const inv of batch) {
      processed++;
      try {
        // Enrich items with ItemMaster tallySalesLedger + hsn
        const enrichedItems = (inv.items || []).map(item => {
          const name = (item.description || item.name || '').trim();
          const im   = masterMap.get(name);
          return {
            ...item,
            hsn:              item.hsn              || im?.hsn              || '',
            tallySalesLedger: item.tallySalesLedger || im?.tallySalesLedger || name,
          };
        });

        const invoiceData = { ...inv, items: enrichedItems };
        const tv = normalizeToTallyVoucher(invoiceData, { periodEnd });

        // Debug: print what we're storing for this invoice
        console.log(`  [${pad(processed)}/${total}] ${inv.invoiceNo}`);
        console.log(`           partyName    : "${inv.partyName}"`);
        console.log(`           purchaseOrderRef: "${inv.purchaseOrderRef || ''}"`);
        console.log(`           poDate       : "${inv.poDate || ''}" → tallyVoucher.poDate="${tv.poDate}"`);
        console.log(`           shipToName   : "${inv.shipToName || ''}" → tallyVoucher.shipToName="${tv.shipToName}"`);
        console.log(`           shipToAddress: "${inv.shipToAddress || ''}" → tallyVoucher.shipToAddress="${tv.shipToAddress}"`);
        console.log(`           billToName   : "${inv.billToName || ''}" → tallyVoucher.billToName="${tv.billToName}"`);
        console.log(`           items        : ${enrichedItems.length} → inventoryEntries=${tv.allInventoryEntries?.length || 0} (useInventory=${tv._useInventory})`);
        enrichedItems.forEach((it, j) => {
          console.log(`             item[${j}] "${it.description}" tallySalesLedger="${it.tallySalesLedger}"`);
        });

        ops.push({
          updateOne: {
            filter: { _id: inv._id },
            update: {
              $set: {
                tallyVoucher: tv,
                // Reset tallySync so updated voucher gets re-exported to Tally
                tallySync:   false,
                tallySyncAt: null,
              },
            },
          },
        });
        updated++;
      } catch (err) {
        console.log(`  [${pad(processed)}/${total}] ${inv.invoiceNo} — ⚠ SKIPPED: ${err.message}`);
        skipped++;
      }
    }

    // Write batch
    if (ops.length) {
      await Invoice.bulkWrite(ops, { ordered: false });
    }

    cursor += batch.length;
    console.log(`\n  ── Batch done: ${cursor}/${total} processed, ${updated} updated, ${skipped} skipped, ${failed} failed\n`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ DONE`);
  console.log(`   Total processed : ${processed}`);
  console.log(`   Updated         : ${updated}`);
  console.log(`   Skipped (error) : ${skipped}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Check the output above — verify shipToName, poDate, items look correct');
  console.log('  2. Go to ERP → Tally page → Export to Tally');
  console.log('     All updated invoices will be re-exported with the corrected fields.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
}

main().catch(e => {
  console.error('\n❌ Fatal error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
