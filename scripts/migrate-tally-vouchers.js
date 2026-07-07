/**
 * migrate-tally-vouchers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time (idempotent) migration script: populates the `tallyVoucher`
 * sub-document on all existing Invoice documents that don't have one yet.
 *
 * Usage:
 *   node scripts/migrate-tally-vouchers.js
 *
 * Safe to run multiple times — already-migrated invoices are skipped.
 * Failures per invoice are logged and skipped without stopping the run.
 * A timestamped report is written to the working directory on completion.
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

import Invoice from '../models/Invoice.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH_SIZE = 100;

async function run() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile   = path.join(__dirname, `migration-tally-voucher-${timestamp}.log`);

  const lines = [];
  const log = (msg) => { console.log(msg); lines.push(msg); };

  log(`=== migrate-tally-vouchers START === ${new Date().toISOString()}`);

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  log('MongoDB connected');

  const cfg = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
  const periodEnd = cfg?.tallyPeriodEnd || null;
  log(`periodEnd from TallyConfig: ${periodEnd || '(none — will use today)'}`);

  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalSkipped   = 0;
  let totalFailed    = 0;
  const failures     = [];

  // Cursor-based iteration ordered by _id — cursor never loads all docs into memory
  const cursor = Invoice.find(
    // Only process invoices that have no tallyVoucher (null or field absent)
    { $or: [{ tallyVoucher: null }, { tallyVoucher: { $exists: false } }] }
  ).select('-__v').lean().cursor();

  let batch = [];

  const processBatch = async (docs) => {
    for (const inv of docs) {
      totalProcessed++;
      try {
        const tv = normalizeToTallyVoucher(inv, { periodEnd });
        await Invoice.updateOne(
          { _id: inv._id },
          { $set: { tallyVoucher: tv } }
        );
        totalSucceeded++;
      } catch (err) {
        totalFailed++;
        const entry = { id: String(inv._id), invoiceNo: inv.invoiceNo || '?', error: err.message };
        failures.push(entry);
        log(`  FAILED  ${entry.id}  ${entry.invoiceNo}  — ${entry.error}`);
      }
    }
  };

  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH_SIZE) {
      try {
        await processBatch(batch);
        log(`Processed batch — cumulative: ${totalProcessed} processed / ${totalSucceeded} ok / ${totalFailed} failed`);
      } catch (batchErr) {
        log(`  BATCH ERROR (offset ~${totalProcessed}): ${batchErr.message} — will retry on next run`);
      }
      batch = [];
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await processBatch(batch);
  }

  // Count already-migrated (skipped)
  totalSkipped = await Invoice.countDocuments({ tallyVoucher: { $ne: null, $exists: true } });

  const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

  log('');
  log('=== MIGRATION SUMMARY ===');
  log(`  Duration:        ${duration}`);
  log(`  Newly migrated:  ${totalSucceeded}`);
  log(`  Failed:          ${totalFailed}`);
  log(`  Already had TV:  ${totalSkipped} (skipped)`);
  log(`  Total processed: ${totalProcessed}`);
  if (failures.length > 0) {
    log('');
    log('Failed invoices:');
    failures.forEach(f => log(`  ${f.id}  ${f.invoiceNo}  ${f.error}`));
  }
  log('');
  log(`Report written to: ${logFile}`);

  fs.writeFileSync(logFile, lines.join('\n'), 'utf8');

  await mongoose.disconnect();
  log('Done.');
  process.exit(totalFailed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
