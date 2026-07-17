import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGODB_URI);

// Find a recent ERP invoice (not from Tally)
const inv = await Invoice.findOne({
  source: { $nin: ['Tally', 'tally'] },
  grandTotal: { $gt: 0 }
}).sort({ createdAt: -1 }).lean();

if (!inv) {
  console.log('No ERP invoices found');
  process.exit(0);
}

console.log('\n=== INVOICE DATA ===');
console.log('invoiceNo:  ', inv.invoiceNo);
console.log('partyName:  ', inv.partyName);
console.log('grandTotal: ', inv.grandTotal);
console.log('cgstTotal:  ', inv.cgstTotal);
console.log('sgstTotal:  ', inv.sgstTotal);
console.log('igstTotal:  ', inv.igstTotal);
console.log('totalTax:   ', inv.totalTax);
console.log('status:     ', inv.status);
console.log('source:     ', inv.source);
console.log('tallySync:  ', inv.tallySync);

if (inv.items?.length) {
  console.log('\n=== ITEMS ===');
  inv.items.forEach((it, i) => {
    console.log(`item[${i}]:`, {
      desc:   it.description,
      qty:    it.qty,
      rate:   it.rate,
      amount: it.amount,
      cgst:   it.cgst,
      sgst:   it.sgst,
      igst:   it.igst,
      total:  it.total,
    });
  });
}

// Check balance:
const itemAmounts = inv.items?.reduce((s, i) => s + (i.amount || 0), 0) || 0;
const itemCgst = inv.items?.reduce((s, i) => s + (i.cgst || 0), 0) || 0;
const itemSgst = inv.items?.reduce((s, i) => s + (i.sgst || 0), 0) || 0;
const itemIgst = inv.items?.reduce((s, i) => s + (i.igst || 0), 0) || 0;
const totalTax = itemCgst + itemSgst + itemIgst;
const computed = itemAmounts + totalTax;

console.log('\n=== BALANCE CHECK ===');
console.log('Sum of item amounts (taxable): ', itemAmounts.toFixed(2));
console.log('CGST sum:                      ', itemCgst.toFixed(2));
console.log('SGST sum:                      ', itemSgst.toFixed(2));
console.log('IGST sum:                      ', itemIgst.toFixed(2));
console.log('Computed grand total:          ', computed.toFixed(2));
console.log('Stored grandTotal:             ', inv.grandTotal);
console.log('BALANCED?                      ', Math.abs(computed - inv.grandTotal) < 1 ? 'YES ✅' : 'NO ❌ — mismatch by ' + Math.abs(computed - inv.grandTotal).toFixed(2));

await mongoose.disconnect();
