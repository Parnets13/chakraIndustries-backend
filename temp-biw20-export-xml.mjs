import connectDB from './config/database.js';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from './services/tallyExportService.js';
import fs from 'fs';

await connectDB();
const invoiceNo = process.env.INVOICE_NO || process.argv[2];
if (!invoiceNo) { console.error('Provide invoiceNo via INVOICE_NO env or CLI arg'); process.exit(1); }
const inv = await Invoice.findOne({ invoiceNo }).lean();
if (!inv) { console.error(`Invoice ${invoiceNo} not found`); process.exit(1); }
const tv = normalizeToTallyVoucher(inv, { periodEnd: null });
console.log('NORMALIZED DATE:', tv.date);
console.log('NORMALIZED EFFECTIVE DATE:', tv.effectiveDate);
const xml = serializeTallyVoucher(tv, { state: '', gstin: '', companyName: '' }, 'Create', '');
console.log('XML SNIPPET:');
const idx = xml.indexOf('<DATE>');
if (idx !== -1) {
  const snippet = xml.slice(Math.max(0, idx-50), idx+80);
  console.log(snippet);
}
console.log(xml.replace(/\r?\n/g, '\n'));
process.exit(0);
