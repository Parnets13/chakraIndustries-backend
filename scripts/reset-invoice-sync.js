/**
 * reset-invoice-sync.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Resets tallySync=false for a batch of invoices so they get re-exported to
 * Tally with the corrected tax amounts (fixes "Tax amount does not match" /
 * e-invoice not printing issue).
 *
 * Usage:
 *   node --experimental-vm-modules scripts/reset-invoice-sync.js
 *     --batch BIW953,BIW954,BIW955    (comma-separated invoice numbers)
 *   OR
 *   node --experimental-vm-modules scripts/reset-invoice-sync.js
 *     --uploadBatch BATCH-1752640000000   (reset entire upload batch)
 *   OR
 *   node --experimental-vm-modules scripts/reset-invoice-sync.js
 *     --date 2026-07-16                   (reset all invoices from a date)
 *
 * IMPORTANT: After running this script you MUST also manually delete the
 * corresponding vouchers from Tally (by voucher number) before re-exporting,
 * otherwise Tally will reject them as duplicates.
 */

import dotenv    from 'dotenv';
import path      from 'path';
import { fileURLToPath } from 'url';
import connectDB from '../config/database.js';
import Invoice   from '../models/Invoice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
};

async function main() {
  await connectDB();

  const batchArg       = getArg('--batch');
  const uploadBatchArg = getArg('--uploadBatch');
  const dateArg        = getArg('--date');

  let filter = {};
  let description = '';

  if (batchArg) {
    const invoiceNos = batchArg.split(',').map(s => s.trim()).filter(Boolean);
    filter = { invoiceNo: { $in: invoiceNos } };
    description = `invoice numbers: ${invoiceNos.join(', ')}`;
  } else if (uploadBatchArg) {
    filter = { uploadBatch: uploadBatchArg.trim() };
    description = `upload batch: ${uploadBatchArg}`;
  } else if (dateArg) {
    const start = new Date(dateArg);
    const end   = new Date(dateArg);
    end.setDate(end.getDate() + 1);
    filter = {
      invoiceDate: { $gte: start, $lt: end },
      source: { $nin: ['Tally', 'tally'] },
    };
    description = `invoice date: ${dateArg}`;
  } else {
    console.error('❌ No filter provided. Use --batch, --uploadBatch, or --date');
    console.error('   Example: node scripts/reset-invoice-sync.js --batch BIW953,BIW954,BIW955');
    process.exit(1);
  }

  // Show what will be affected before making changes
  const invoices = await Invoice.find(filter, 'invoiceNo invoiceDate partyName tallySync uploadBatch').lean();

  if (!invoices.length) {
    console.log('⚠️  No invoices found matching filter:', JSON.stringify(filter));
    process.exit(0);
  }

  console.log(`\nFound ${invoices.length} invoice(s) matching ${description}:\n`);
  invoices.forEach(inv => {
    console.log(`  ${inv.invoiceNo.padEnd(15)}  ${inv.partyName?.slice(0,30).padEnd(32)}  tallySync=${String(inv.tallySync).padEnd(6)}  batch=${inv.uploadBatch || '—'}`);
  });

  console.log(`\n⚠️  This will set tallySync=false and clear tallySyncAt, retryCount, lastError`);
  console.log(`   for ${invoices.length} invoice(s).`);
  console.log(`\n   REMEMBER: You must ALSO delete these vouchers from Tally manually`);
  console.log(`   before re-exporting, or Tally will reject them as duplicate voucher numbers.\n`);

  // Auto-confirm if --yes flag provided, else prompt
  const autoYes = args.includes('--yes');
  if (!autoYes) {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(resolve => {
      rl.question('Proceed? (yes/no): ', (answer) => {
        rl.close();
        if (answer.toLowerCase() !== 'yes') {
          console.log('Aborted.');
          process.exit(0);
        }
        resolve();
      });
    });
  }

  const result = await Invoice.updateMany(filter, {
    $set: {
      tallySync:   false,
      retryCount:  0,
      lastError:   '',
    },
    $unset: {
      tallySyncAt:        '',
      tallyGuid:          '',
      tallyAlterId:       '',
      tallyVoucherNumber: '',
    },
  });

  console.log(`\n✅ Reset complete: ${result.modifiedCount} invoice(s) updated.`);
  console.log(`\nNext steps:`);
  console.log(`  1. In Tally: delete the vouchers for these invoice numbers`);
  console.log(`  2. In your ERP: click "Export to Tally → Sales Invoices"`);
  console.log(`  3. In Tally: verify the vouchers re-appear with correct tax amounts`);
  console.log(`  4. In Tally: generate e-invoice (Gateway of Tally → E-Invoice)`);

  process.exit(0);
}

main().catch(e => {
  console.error('❌ Fatal:', e.message);
  process.exit(1);
});
