/**
 * remigrate-tally-gst-fields.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Re-normalizes ALL Invoice.tallyVoucher sub-documents to populate the new
 * GST source fields:
 *   - gstSourceType / gstLedgerSource   (GSTSOURCETYPE / GSTLEDGERSOURCE)
 *   - hsnSourceType / hsnLedgerSource   (HSNSOURCETYPE / HSNLEDGERSOURCE)
 *   - gstOverrideTaxability             (GSTOVRDNTAXABILITY)
 *   - gstOverrideSupplyType             (GSTOVRDNTYPEOFSUPPLY)
 *   - gstHsnName                        (GSTHSNNAME)
 *
 * KEY FIX: loads ALL ItemMaster records into memory first so each invoice item
 * can be enriched with the correct tallySalesLedger and hsn values before
 * normalizeToTallyVoucher is called. Without this, gstLedgerSource was always
 * 'Sales Accounts' because invoiceItemSchema had no tallySalesLedger field.
 *
 * Safe to run multiple times. Processes ALL invoices.
 *
 * Usage (run on server with MONGO_URI in env):
 *   node scripts/remigrate-tally-gst-fields.js
 */

import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import Invoice    from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

async function run() {
  const start = Date.now();
  console.log(`=== remigrate-tally-gst-fields START === ${new Date().toISOString()}`);

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('MongoDB connected');

  const cfg = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
  const periodEnd = cfg?.tallyPeriodEnd || null;
  console.log(`periodEnd: ${periodEnd || '(none)'}`);

  // ── Pre-load ALL ItemMaster records into a name → master map ───────────────
  // This avoids per-invoice DB queries and makes the migration fast.
  const allItems = await ItemMaster.find({}, 'name hsn tallySalesLedger gst').lean();
  const masterMap = new Map(allItems.map(m => [m.name, m]));
  console.log(`Loaded ${masterMap.size} ItemMaster records`);

  // Show a sample of what tallySalesLedger values exist
  const withLedger = allItems.filter(m => m.tallySalesLedger);
  console.log(`  ${withLedger.length} items have tallySalesLedger set`);
  if (withLedger.length > 0) {
    console.log(`  Sample: ${withLedger.slice(0, 5).map(m => `"${m.name}" → "${m.tallySalesLedger}"`).join(', ')}`);
  } else {
    console.log('  ⚠  No items have tallySalesLedger — gstLedgerSource will be "Sales Accounts" for all');
    console.log('  To set item-specific ledger names:');
    console.log('    • Run a Tally sync to fetch real ledger names from your Tally company');
    console.log('    • Or manually set ItemMaster.tallySalesLedger for each item in the DB');
  }

  // ── Helper: enrich invoice items with ItemMaster data ─────────────────────
  function enrichItems(items) {
    return (items || []).map(item => {
      const name = (item.description || item.name || '').trim();
      const im   = masterMap.get(name);
      return {
        ...item,
        hsn:              item.hsn              || im?.hsn              || '',
        tallySalesLedger: item.tallySalesLedger  || im?.tallySalesLedger || '',
      };
    });
  }

  let processed = 0, succeeded = 0, failed = 0, skipped = 0;
  const failures = [];

  const cursor = Invoice.find({ invoiceNo: { $exists: true, $ne: '' } })
    .select('-__v').lean().cursor();

  for await (const inv of cursor) {
    processed++;
    try {
      const grandTotal = +(inv.grandTotal || inv.totalAmount || 0);
      if (!inv.partyName || grandTotal <= 0) { skipped++; continue; }

      // Enrich items with ItemMaster tallySalesLedger + hsn
      const enrichedItems = enrichItems(inv.items);
      const tv = normalizeToTallyVoucher({ ...inv, items: enrichedItems }, { periodEnd });

      await Invoice.updateOne({ _id: inv._id }, { $set: { tallyVoucher: tv } });
      succeeded++;
      if (succeeded % 50 === 0) {
        console.log(`  ... ${succeeded} re-normalized so far`);
      }
    } catch (err) {
      failed++;
      failures.push({ invoiceNo: inv.invoiceNo || String(inv._id), error: err.message });
      if (failed <= 20) console.error(`  FAILED ${inv.invoiceNo || inv._id}: ${err.message}`);
    }
  }

  const dur = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== DONE in ${dur}s ===`);
  console.log(`  Processed : ${processed}`);
  console.log(`  Succeeded : ${succeeded}`);
  console.log(`  Skipped   : ${skipped}`);
  console.log(`  Failed    : ${failed}`);
  if (failures.length > 20) console.log(`  (${failures.length - 20} more failures not shown)`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.slice(0, 20).forEach(f => console.log(`  ${f.invoiceNo} — ${f.error}`));
  }

  await mongoose.disconnect();
  console.log('\nNext step: run a fresh Sales export to Tally to push updated vouchers.');
  process.exit(0);
}

run().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
