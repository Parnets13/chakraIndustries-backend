/**
 * Checks which invoices actually made it to Tally (tallySync=true)
 * vs which are stuck failing. Also checks the amounts to spot any pattern.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);

const synced = await Invoice.find({ tallySync: true }).sort({ tallySyncAt: -1 }).limit(20).lean();
console.log('=== Invoices that DID export successfully (tallySync=true) ===');
synced.forEach(inv => {
  const cgst = +(inv.cgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0));
  const sgst = +(inv.sgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0));
  const igst = +(inv.igstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0));
  const base = +((inv.grandTotal||0) - cgst - sgst - igst);
  console.log(
    ' ', inv.invoiceNo,
    '| ₹' + inv.grandTotal,
    '| cgst:' + cgst, 'sgst:' + sgst, 'igst:' + igst,
    '| base:' + base.toFixed(2),
    '| party:', inv.partyName,
    '| synced:', new Date(inv.tallySyncAt).toLocaleString('en-IN')
  );
});

console.log('\n=== Pending invoices (BIW - first 5 detail) ===');
const pending = await Invoice.find({ tallySync: { $ne: true }, source: { $nin: ['Tally','tally'] }, status: { $nin: ['Cancelled'] } }).limit(5).lean();
pending.forEach(inv => {
  const cgst = +(inv.cgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0));
  const sgst = +(inv.sgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0));
  const igst = +(inv.igstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0));
  const base = +((inv.grandTotal||0) - cgst - sgst - igst);
  const creditSum = +(cgst + sgst + igst + base).toFixed(2);
  console.log(
    ' ', inv.invoiceNo,
    '| ₹' + inv.grandTotal,
    '| cgst:' + cgst, 'sgst:' + sgst, 'igst:' + igst,
    '| base:' + base.toFixed(2),
    '| creditSum:' + creditSum,
    '| BALANCED:', Math.abs(inv.grandTotal - creditSum) < 0.01 ? 'YES' : 'NO ❌',
    '| party:', inv.partyName
  );
  // Show raw items
  (inv.items||[]).forEach(it => console.log(
    '     item:', it.description||it.name,
    'qty:', it.qty, 'rate:', it.rate||it.unitPrice||it.basePrice,
    'cgst:', it.cgst, 'sgst:', it.sgst, 'igst:', it.igst
  ));
});

await mongoose.disconnect();
