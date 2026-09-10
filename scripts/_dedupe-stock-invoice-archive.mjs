/**
 * Removes duplicate records from StockInvoiceArchive (the /inventory/stock-invoices
 * page source). Keeps ONE record per invoiceNo (the newest by originalUpdatedAt /
 * createdAt / _id), deletes the rest.
 *
 * SAFE: dry-run by default (counts only, deletes nothing).
 * To actually delete, pass  --apply
 *
 * Usage:
 *   node scripts/_dedupe-stock-invoice-archive.mjs            (dry run)
 *   node scripts/_dedupe-stock-invoice-archive.mjs --apply     (delete duplicates)
 *   $env:MONGO_URI="<prod uri>"; node scripts/_dedupe-stock-invoice-archive.mjs --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import StockInvoiceArchive from '../models/StockInvoiceArchive.js';

const APPLY = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
console.log(`DB: ${mongoose.connection.name}  |  MODE: ${APPLY ? 'APPLY (deleting)' : 'DRY-RUN (no changes)'}\n`);

const before = await StockInvoiceArchive.countDocuments();
console.log(`Total archive records before: ${before}`);

// Group by invoiceNo; for each group pick the ONE to keep, collect the rest to delete.
const groups = await StockInvoiceArchive.aggregate([
  { $group: {
      _id: '$invoiceNo',
      docs: { $push: { id: '$_id', updatedAt: '$originalUpdatedAt', createdAt: '$createdAt' } },
      count: { $sum: 1 },
  } },
  { $match: { count: { $gt: 1 } } },
]);

let toDelete = [];
for (const g of groups) {
  // Keep the newest: sort by updatedAt then createdAt then _id, descending
  const sorted = g.docs.slice().sort((a, b) => {
    const au = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bu = new Date(b.updatedAt || b.createdAt || 0).getTime();
    if (bu !== au) return bu - au;
    return String(b.id).localeCompare(String(a.id));
  });
  // keep sorted[0], delete the rest
  toDelete.push(...sorted.slice(1).map(d => d.id));
}

console.log(`Duplicate invoiceNo groups: ${groups.length}`);
console.log(`Records that will be DELETED (extra copies): ${toDelete.length}`);
console.log(`Records that will REMAIN: ${before - toDelete.length}\n`);

if (!APPLY) {
  console.log('DRY-RUN complete. Nothing deleted. Re-run with --apply to delete the duplicates.');
  await mongoose.disconnect();
  process.exit(0);
}

// Delete in chunks to avoid a huge single query
let deleted = 0;
const CHUNK = 500;
for (let i = 0; i < toDelete.length; i += CHUNK) {
  const slice = toDelete.slice(i, i + CHUNK);
  const res = await StockInvoiceArchive.deleteMany({ _id: { $in: slice } });
  deleted += res.deletedCount || 0;
  console.log(`  deleted ${deleted}/${toDelete.length}...`);
}

const after = await StockInvoiceArchive.countDocuments();
console.log(`\n✓ Done. Deleted ${deleted} duplicates.`);
console.log(`Archive records after: ${after} (was ${before})`);

await mongoose.disconnect();
process.exit(0);
