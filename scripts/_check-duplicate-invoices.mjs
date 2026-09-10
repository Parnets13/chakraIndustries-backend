/**
 * READ-ONLY. Checks the StockInvoiceArchive collection (the /inventory/stock-invoices
 * page source) for duplicate invoiceNo, and orphan archives (originalInvoiceId no
 * longer in Invoice). Changes nothing.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import StockInvoiceArchive from '../models/StockInvoiceArchive.js';

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
console.log('DB:', mongoose.connection.name, '\n');

const totalArch = await StockInvoiceArchive.countDocuments();
const totalInv  = await Invoice.countDocuments();
console.log(`StockInvoiceArchive docs: ${totalArch}`);
console.log(`Invoice docs:            ${totalInv}\n`);

// Duplicate invoiceNo inside the archive
const dup = await StockInvoiceArchive.aggregate([
  { $group: { _id: '$invoiceNo', count: { $sum: 1 }, ids: { $push: '$_id' }, origIds: { $push: '$originalInvoiceId' } } },
  { $match: { count: { $gt: 1 } } },
  { $sort: { count: -1 } },
]);
console.log(`════════ Duplicate invoiceNo in ARCHIVE: ${dup.length} ════════`);
for (const d of dup.slice(0, 60)) {
  const distinctOrig = new Set(d.origIds.map(x => x?.toString())).size;
  console.log(`  "${d._id}" ×${d.count}  (distinct originalInvoiceId: ${distinctOrig})`);
}

// Orphan archives — originalInvoiceId not present in Invoice
const allOrig = await StockInvoiceArchive.distinct('originalInvoiceId');
let orphan = 0;
for (const id of allOrig) {
  if (!id) { orphan++; continue; }
  const exists = await Invoice.exists({ _id: id });
  if (!exists) orphan++;
}
console.log(`\nArchive records whose originalInvoiceId is missing from Invoice (orphans): ${orphan}`);

await mongoose.disconnect();
process.exit(0);
