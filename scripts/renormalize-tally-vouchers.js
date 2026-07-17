#!/usr/bin/env node
/**
 * renormalize-tally-vouchers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Re-runs normalizeToTallyVoucher on all invoices that have NOT yet been synced
 * to Tally (tallySync != true). This rebuilds the tallyVoucher sub-document
 * with the latest logic — specifically the "Sales Accounts → Sales" ledger fix
 * and the comprehensive narration with item details.
 *
 * Safe to run multiple times — only touches invoices where tallySync is false/null.
 *
 * Usage: node scripts/renormalize-tally-vouchers.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected to MongoDB');

  const cfg = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
  const periodEnd = cfg?.tallyPeriodEnd || null;
  console.log(`Period end: ${periodEnd || '(none)'}`);

  // Find all invoices not yet synced to Tally
  const invoices = await Invoice.find({
    tallySync: { $ne: true },
    source: { $nin: ['Tally', 'tally'] },
    status: { $nin: ['Cancelled'] },
  }).lean();

  console.log(`Found ${invoices.length} unsynced invoices to re-normalize`);

  // Pre-fetch all ItemMaster data
  const allNames = [...new Set(
    invoices.flatMap(inv => (inv.items || []).map(i => (i.description || i.name || '').trim()).filter(Boolean))
  )];
  const masters = allNames.length
    ? await ItemMaster.find({ name: { $in: allNames } }, 'name hsn tallySalesLedger').lean()
    : [];
  const masterMap = new Map(masters.map(m => [m.name, m]));
  console.log(`Loaded ${masters.length} ItemMaster entries`);

  let updated = 0, failed = 0, skipped = 0;

  for (const inv of invoices) {
    try {
      // Enrich items with ItemMaster data
      const enrichedItems = (inv.items || []).map(item => {
        const name = (item.description || item.name || '').trim();
        const im = masterMap.get(name);
        return {
          ...item,
          hsn: (item.hsn || '').trim() || (im?.hsn || '').trim(),
          tallySalesLedger: (item.tallySalesLedger || '').trim() || (im?.tallySalesLedger || '').trim(),
        };
      });

      const newVoucher = normalizeToTallyVoucher(
        { ...inv, items: enrichedItems },
        { periodEnd }
      );

      // Check if ledger changed from old "Sales Accounts" to something real
      const oldLedgers = (inv.tallyVoucher?.allLedgerEntries || []).map(e => e.ledgerName);
      const newLedgers = (newVoucher.allLedgerEntries || []).map(e => e.ledgerName);
      const oldHadSalesAccounts = oldLedgers.includes('Sales Accounts');
      const newHasSalesAccounts = newLedgers.includes('Sales Accounts');

      if (oldHadSalesAccounts && !newHasSalesAccounts) {
        console.log(`  ✓ ${inv.invoiceNo}: fixed "Sales Accounts" → "${newLedgers[newLedgers.length - 1]}"`);
      } else if (!inv.tallyVoucher) {
        console.log(`  ✓ ${inv.invoiceNo}: created tallyVoucher (was null)`);
      } else {
        console.log(`  ○ ${inv.invoiceNo}: updated (sales ledger="${newLedgers[newLedgers.length - 1]}")`);
      }

      await Invoice.updateOne(
        { _id: inv._id },
        { $set: { tallyVoucher: newVoucher, items: enrichedItems } }
      );
      updated++;
    } catch (err) {
      console.warn(`  ✗ ${inv.invoiceNo}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone — updated: ${updated}, failed: ${failed}, skipped: ${skipped}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
