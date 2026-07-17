import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

dotenv.config();

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

const inv = await Invoice.findOne({ invoiceNo: 'BIW11' }).lean();
if (!inv) {
  console.log('Invoice BIW11 not found');
  process.exit(1);
}

const periodEnd = null;
const voucher = normalizeToTallyVoucher(inv, { periodEnd });
console.log('normalized tallyVoucher:', JSON.stringify(voucher, null, 2));

console.log(JSON.stringify({
  invoiceNo: inv.invoiceNo,
  partyName: inv.partyName,
  status: inv.status,
  source: inv.source,
  tallySync: inv.tallySync,
  retryCount: inv.retryCount,
  lastError: inv.lastError,
  lastTriedAt: inv.lastTriedAt,
  tallySyncAt: inv.tallySyncAt,
  grandTotal: inv.grandTotal,
  totalTax: inv.totalTax,
  cgstTotal: inv.cgstTotal,
  sgstTotal: inv.sgstTotal,
  igstTotal: inv.igstTotal,
  items: inv.items,
  tallyVoucher: inv.tallyVoucher,
}, null, 2));

const itemsAmount = (inv.items || []).reduce((s, i) => s + (i.amount || 0), 0);
const cgstSum = (inv.items || []).reduce((s, i) => s + (i.cgst || 0), 0);
const sgstSum = (inv.items || []).reduce((s, i) => s + (i.sgst || 0), 0);
const igstSum = (inv.items || []).reduce((s, i) => s + (i.igst || 0), 0);
const total = itemsAmount + cgstSum + sgstSum + igstSum;
console.log('balance check:', { itemsAmount, cgstSum, sgstSum, igstSum, total, grandTotal: inv.grandTotal, diff: +(total - inv.grandTotal).toFixed(2) });

await mongoose.disconnect();
process.exit(0);
