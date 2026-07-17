/**
 * set-item-sales-ledger.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Sets tallySalesLedger and hsn on ItemMaster items that are used in
 * Excel-uploaded invoices but have no tallySalesLedger.
 *
 * IMPORTANT: The tallySalesLedger value must match an EXACT ledger name that
 * exists (or will be auto-created) in Tally. This script sets it to the
 * auto-created ledger names used by the export engine so they always match.
 *
 * GST rule for this invoice set:
 *   CGST 2.5% + SGST 2.5% = 5% total → local sale at 5% GST
 *   Tally ledger = "Sales Accounts" (generic) ... BUT that is a GROUP not a ledger.
 *
 * The correct approach for items without a specific Tally sales ledger is to
 * use a ledger name that the export engine auto-creates: e.g. "Sales @ 5%"
 * or to let the export fall back to pure-accounting mode.
 *
 * VERDICT: For BI Worldwide invoices the item IS the product. Set tallySalesLedger
 * to "Sales" — Tally's built-in default sales ledger (a real ledger, not a group).
 * The export engine already auto-creates "Sales Accounts" group. We need a real ledger.
 *
 * Run: node scripts/set-item-sales-ledger.js
 *
 * Argument --dry-run to preview without writing.
 */

import dotenv     from 'dotenv';
import connectDB  from '../config/database.js';
import ItemMaster from '../models/ItemMaster.js';
import Invoice    from '../models/Invoice.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');

// ── The sales ledger name to use for items without one ────────────────────────
// This MUST be a real Tally LEDGER (not a Group). The export engine auto-creates
// GST ledgers like "Output CGST @ 2.5%" and "Output SGST @ 2.5%", but for sales
// item lines we need the corresponding sales income ledger.
//
// If your Tally company has a specific ledger for this product (e.g. "Bottle Sales"),
// change SALES_LEDGER_NAME to that exact name.
// If you want a generic fallback, use "Sales" (Tally default) — we'll auto-create it.
const SALES_LEDGER_NAME = 'Sales';
const HSN_CODE = '732393'; // from Excel: HSN column

await connectDB();

console.log(`\nDry run: ${DRY_RUN ? 'YES (no writes)' : 'NO (will write)'}`);
console.log(`Sales ledger to set: "${SALES_LEDGER_NAME}"`);
console.log(`HSN code to set    : "${HSN_CODE}"\n`);

// Find all unique item names used in Excel-uploaded invoices
const excelInvoices = await Invoice.find({ source: 'excel_upload' }, 'items').lean();
const itemNames = [...new Set(
  excelInvoices.flatMap(inv =>
    (inv.items || []).map(i => (i.description || i.name || '').trim()).filter(Boolean)
  )
)];

console.log(`Items found in Excel invoices: ${itemNames.length}`);
itemNames.forEach(n => console.log(`  "${n}"`));

// Check which ones lack tallySalesLedger
const items = await ItemMaster.find({ name: { $in: itemNames } }, 'name tallySalesLedger hsn gst').lean();
const needsUpdate = items.filter(i => !i.tallySalesLedger);

console.log(`\nItems WITHOUT tallySalesLedger: ${needsUpdate.length}`);
needsUpdate.forEach(i => console.log(`  "${i.name}" | current hsn="${i.hsn}" gst=${i.gst}`));

if (!needsUpdate.length) {
  console.log('\n✅ All items already have tallySalesLedger set. Nothing to do.');
  process.exit(0);
}

if (!DRY_RUN) {
  // Set tallySalesLedger and HSN on items that need it
  const nameList = needsUpdate.map(i => i.name);
  const result = await ItemMaster.updateMany(
    { name: { $in: nameList } },
    { $set: { tallySalesLedger: SALES_LEDGER_NAME, hsn: HSN_CODE } }
  );
  console.log(`\n✅ Updated ${result.modifiedCount} ItemMaster records`);
  console.log(`   tallySalesLedger = "${SALES_LEDGER_NAME}"`);
  console.log(`   hsn              = "${HSN_CODE}"`);

  // Now re-normalize all affected Excel invoices with the new ledger
  console.log('\nRe-normalizing Excel invoices with updated tallySalesLedger...');
  const cfg = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
  const periodEnd = cfg?.tallyPeriodEnd || null;

  const invoices = await Invoice.find({ source: 'excel_upload' }).lean();
  const ops = [];

  for (const inv of invoices) {
    try {
      const enrichedItems = (inv.items || []).map(item => {
        const name = (item.description || item.name || '').trim();
        const inList = nameList.includes(name);
        return {
          ...item,
          hsn:              inList ? HSN_CODE          : (item.hsn || ''),
          tallySalesLedger: inList ? SALES_LEDGER_NAME : (item.tallySalesLedger || ''),
        };
      });
      const tv = normalizeToTallyVoucher({ ...inv, items: enrichedItems }, { periodEnd });
      const useInv = tv._useInventory;
      console.log(`  ${inv.invoiceNo}: useInventory=${useInv} inventoryEntries=${tv.allInventoryEntries?.length || 0}`);
      ops.push({
        updateOne: {
          filter: { _id: inv._id },
          update: { $set: { tallyVoucher: tv, tallySync: false, tallySyncAt: null } },
        },
      });
    } catch (err) {
      console.log(`  ${inv.invoiceNo}: SKIPPED — ${err.message}`);
    }
  }

  if (ops.length) {
    await Invoice.bulkWrite(ops, { ordered: false });
    console.log(`\n✅ Re-normalized ${ops.length} invoices`);
  }
} else {
  console.log('\n[DRY RUN] Would update:');
  needsUpdate.forEach(i =>
    console.log(`  "${i.name}": tallySalesLedger="" → "${SALES_LEDGER_NAME}", hsn="${i.hsn}" → "${HSN_CODE}"`)
  );
  console.log('\nRe-run without --dry-run to apply.');
}

console.log('\nNext: Go to ERP → Tally → Export to Tally');
console.log('       Vouchers will now include ALLINVENTORYENTRIES with item names.');
process.exit(0);
