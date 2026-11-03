// why-ranges-failed.js — READ ONLY diagnostic.
// Explains why BIW2941-2947 and BIW2952-2958 did not export to Tally.
// Shows sync status, saved lastError, retryCount, and every field that the
// export's validation / dedup / HSN / normalize checks look at.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import Invoice from './models/Invoice.js';

// Build the list of invoice numbers in the two reported ranges.
function buildRange(prefix, from, to) {
  const out = [];
  for (let n = from; n <= to; n++) out.push(`${prefix}${n}`);
  return out;
}

async function main() {
  await connectDB();

  // Cover both with/without a "BIW" prefix in case invoiceNo is stored either way.
  const nums = [
    ...buildRange('BIW', 2941, 2947),
    ...buildRange('BIW', 2952, 2958),
    ...buildRange('', 2941, 2947),
    ...buildRange('', 2952, 2958),
  ];

  // Match invoiceNo that CONTAINS any of the numbers (handles prefixes/suffixes).
  const numericCores = [
    ...buildRange('', 2941, 2947),
    ...buildRange('', 2952, 2958),
  ];
  const regex = new RegExp(numericCores.join('|'));

  const invoices = await Invoice.find({ invoiceNo: regex })
    .select('invoiceNo partyName partyState billToState partyGST grandTotal totalAmount status source tallySync tallySyncAt retryCount lastError lastTriedAt buyersOrderNo items tallyVoucher')
    .sort({ invoiceNo: 1 })
    .lean();

  console.log(`\nMatched ${invoices.length} invoices in the two ranges.\n`);
  console.log('='.repeat(90));

  const MAX_RETRIES = 3; // mirror export's MAX_RETRIES assumption for reporting

  for (const inv of invoices) {
    const gt = +(inv.grandTotal || inv.totalAmount || 0);
    console.log(`\n■ ${inv.invoiceNo}`);
    console.log(`   party           : "${inv.partyName || ''}"  state="${inv.partyState || inv.billToState || ''}"`);
    console.log(`   grandTotal      : ${gt}`);
    console.log(`   status/source   : ${inv.status} / ${inv.source}`);
    console.log(`   tallySync       : ${inv.tallySync}  syncedAt=${inv.tallySyncAt || '-'}`);
    console.log(`   retryCount      : ${inv.retryCount ?? 0}  (export excludes when > ${MAX_RETRIES})`);
    console.log(`   lastError       : ${inv.lastError || '(none saved)'}`);
    console.log(`   lastTriedAt     : ${inv.lastTriedAt || '-'}`);
    console.log(`   buyersOrderNo   : "${inv.buyersOrderNo || ''}"`);
    console.log(`   tallyVoucher    : ${inv.tallyVoucher ? 'present' : 'NULL (normalize failed at write time)'}`);

    // Replicate the export's hard validation checks so we can flag the likely block reason.
    const reasons = [];
    if (!inv.invoiceNo || !String(inv.invoiceNo).trim()) reasons.push('invoiceNo missing');
    if (!inv.partyName || !String(inv.partyName).trim()) reasons.push('partyName missing');
    if (!gt || gt <= 0) reasons.push('grandTotal is zero/missing');
    if ((inv.retryCount ?? 0) > MAX_RETRIES) reasons.push(`retryCount ${inv.retryCount} > ${MAX_RETRIES} (EXCLUDED from export query)`);
    if (['Cancelled'].includes(inv.status)) reasons.push('status is Cancelled (excluded)');
    if (['Tally', 'tally'].includes(inv.source)) reasons.push('source is Tally (excluded)');

    const items = inv.items || [];
    if (!items.length) reasons.push('no items');
    items.forEach((it, i) => {
      const name = (it.description || it.name || '').trim();
      if (!name) reasons.push(`item[${i}] has no description/name`);
      if (!(it.hsn || '').trim()) reasons.push(`item[${i}] "${name}" HSN blank in ERP (export blocks if also blank in Tally)`);
      if (!+(it.qty || 0)) reasons.push(`item[${i}] "${name}" qty is 0`);
    });

    console.log(`   ► likely block  : ${reasons.length ? reasons.join('; ') : 'nothing in ERP data — check lastError / Tally EXCEPTIONS above'}`);
  }

  console.log('\n' + '='.repeat(90));
  console.log('\nSUMMARY — grouped by saved lastError:');
  const byErr = new Map();
  invoices.forEach(f => {
    const key = (f.lastError || '(no lastError saved)').trim();
    if (!byErr.has(key)) byErr.set(key, []);
    byErr.get(key).push(f.invoiceNo);
  });
  for (const [err, list] of byErr) {
    console.log(`\n  REASON: ${err}`);
    console.log(`    count: ${list.length}  →  ${list.join(', ')}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
