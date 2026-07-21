/**
 * round-invoice-amounts.js
 * ──────────────────────────────────────────────────────────────────────────
 * One-time migration: rounds basic, cgst, sgst, igst, total on all
 * excel_upload invoices to 2 decimal places, recomputes invoice-level
 * grandTotal, and resets tallySync so they re-export cleanly to Tally.
 *
 * Run:
 *   node scripts/round-invoice-amounts.js
 *
 * Safe to re-run — already-rounded invoices will have changed=false and
 * will not be written again.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

const r2 = (n) => parseFloat((+(n || 0)).toFixed(2));

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) { console.error('❌ MONGO_URI not set in .env'); process.exit(1); }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log('✅ Connected to MongoDB');

  const total = await Invoice.countDocuments({ source: 'excel_upload' });
  console.log(`\nTarget invoices (source=excel_upload): ${total}`);
  if (!total) { console.log('Nothing to do.'); await mongoose.disconnect(); return; }

  let updated = 0, skipped = 0, errors = 0;
  const cursor = Invoice.find({ source: 'excel_upload' }).cursor();

  for await (const inv of cursor) {
    try {
      let changed = false;

      // ── Round each item ──────────────────────────────────────────────────
      for (const item of inv.items || []) {
        const basic = r2(item.basic);
        const cgst  = r2(item.cgst);
        const sgst  = r2(item.sgst);
        const igst  = r2(item.igst);
        const total = r2(basic + cgst + sgst + igst);

        if (basic !== item.basic) { item.basic = basic; changed = true; }
        if (cgst  !== item.cgst)  { item.cgst  = cgst;  changed = true; }
        if (sgst  !== item.sgst)  { item.sgst  = sgst;  changed = true; }
        if (igst  !== item.igst)  { item.igst  = igst;  changed = true; }
        if (total !== item.total) { item.total = total; changed = true; }

        // Also round rate and qty-derived basic if it's a repeating decimal
        const rateRounded = r2(item.rate);
        if (rateRounded !== item.rate) { item.rate = rateRounded; changed = true; }
      }

      if (!changed) { skipped++; continue; }

      // ── Recompute invoice-level totals from rounded items ────────────────
      const newSubtotal  = r2(inv.items.reduce((s, i) => s + (i.basic || 0), 0));
      const newCgstTotal = r2(inv.items.reduce((s, i) => s + (i.cgst  || 0), 0));
      const newSgstTotal = r2(inv.items.reduce((s, i) => s + (i.sgst  || 0), 0));
      const newIgstTotal = r2(inv.items.reduce((s, i) => s + (i.igst  || 0), 0));
      const newGrandTotal = r2(newSubtotal + newCgstTotal + newSgstTotal + newIgstTotal);

      inv.subtotal   = newSubtotal;
      inv.grandTotal = newGrandTotal;

      // ── Reset tallySync so it re-exports with clean rounded values ────────
      inv.tallySync   = false;
      inv.tallySyncAt = null;
      inv.tallyVoucher = null;   // force re-normalization on next export

      await inv.save();
      updated++;

      if (updated % 50 === 0) {
        console.log(`  ... ${updated} updated so far`);
      }
    } catch (err) {
      console.error(`❌ Error on invoice ${inv.invoiceNo}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n── Done ──────────────────────────────────────────────`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped}  (already rounded)`);
  console.log(`  Errors  : ${errors}`);
  console.log(`\nNext step: go to Tally Integration page and click "Export to Tally"`);
  console.log(`to re-export the ${updated} fixed invoices.`);

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
