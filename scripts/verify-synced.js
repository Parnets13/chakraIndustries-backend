import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

const invoices = await Invoice.find({ source: 'excel_upload' }).sort({ invoiceNo: 1 }).lean();

let ok = 0, warn = 0;
for (const inv of invoices) {
  const tv = inv.tallyVoucher;
  const shipState = tv?.shipToState || inv.shipToState || '';
  const billState = tv?.billToState || inv.billToState || '';
  const status = shipState ? '✓' : '⚠';
  if (shipState) ok++; else warn++;
  if (!shipState) {
    console.log(`${status} ${inv.invoiceNo}: shipToState="${shipState}" billToState="${billState}" shipToAddr="${(inv.shipToAddress||'').substring(0,40)}"`);
  }
}

console.log(`\n=== RESULT: ${ok}/100 have shipToState ✓, ${warn} missing ⚠ ===`);
await mongoose.disconnect();
