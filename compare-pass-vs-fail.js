// compare-pass-vs-fail.js — READ ONLY. Compares the archived (PASSED) invoices
// against the 9 current (FAILED) ones to find the REAL difference.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import StockInvoiceArchive from './models/StockInvoiceArchive.js';

async function main() {
  await connectDB();

  // Failed (current) invoices
  const failed = await Invoice.find({ tallySync: { $ne: true } }).lean();
  console.log(`FAILED invoices: ${failed.length}`);

  // Passed = archived. Grab a sample.
  const archived = await StockInvoiceArchive.find({}).sort({ createdAt: -1 }).limit(200).lean();
  console.log(`Archived (passed) records available: ${archived.length}\n`);

  // Helper to extract item-level fields from an invoice-like doc
  const itemsOf = doc => (doc.items || doc.invoice?.items || []);

  // Build sets of item names
  const failItemNames = new Set();
  failed.forEach(f => itemsOf(f).forEach(it => failItemNames.add((it.description||it.name||'').trim())));

  console.log('=== FAILED items (name | taxRate | cgst | sgst | tallySalesLedger | hsn) ===');
  failed.forEach(f => itemsOf(f).forEach(it => {
    console.log(`  ${f.invoiceNo} | "${(it.description||it.name||'').trim()}" | taxRate=${it.taxRate} | cgst=${it.cgst} | sgst=${it.sgst} | ledger="${it.tallySalesLedger||''}" | hsn="${it.hsn||''}"`);
  }));

  console.log('\n=== ARCHIVED (passed) items — showing any with GST 0 or empty ledger/hsn ===');
  let shown = 0;
  for (const a of archived) {
    const inv = a.invoice || a;
    for (const it of itemsOf(a)) {
      const nm = (it.description||it.name||'').trim();
      const zeroish = (!it.taxRate || it.taxRate === 0) || !(it.tallySalesLedger||'').trim() || !(it.hsn||'').trim();
      if (zeroish && shown < 25) {
        console.log(`  ${inv.invoiceNo||a.invoiceNo||'?'} | "${nm}" | taxRate=${it.taxRate} | cgst=${it.cgst} | ledger="${it.tallySalesLedger||''}" | hsn="${it.hsn||''}"`);
        shown++;
      }
    }
  }
  if (shown === 0) console.log('  (no archived passed item had 0 rate / empty ledger / empty hsn)');

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
