import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);

// Get BIW01 raw from DB — check actual stored types and values
const inv = await Invoice.findOne({ invoiceNo: 'BIW01' }).lean();
console.log('BIW01 raw fields:');
console.log('  grandTotal:', inv.grandTotal, typeof inv.grandTotal);
console.log('  totalAmount:', inv.totalAmount, typeof inv.totalAmount);
console.log('  cgstTotal:', inv.cgstTotal, typeof inv.cgstTotal);
console.log('  sgstTotal:', inv.sgstTotal, typeof inv.sgstTotal);
console.log('  igstTotal:', inv.igstTotal, typeof inv.igstTotal);
console.log('  subtotal:', inv.subtotal, typeof inv.subtotal);
console.log('  taxableAmount:', inv.taxableAmount, typeof inv.taxableAmount);
console.log('  partyName:', inv.partyName);
console.log('  items count:', (inv.items||[]).length);
(inv.items||[]).forEach((it, i) => {
  console.log(`  item[${i}]:`, JSON.stringify(it, null, 2));
});

// Simulate the exact amount calculation the export code does
const grandTotal = +(inv.grandTotal || inv.totalAmount || 0).toFixed(2);
const totalCGST  = +(inv.cgstTotal  ?? (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0)).toFixed(2);
const totalSGST  = +(inv.sgstTotal  ?? (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0)).toFixed(2);
const totalIGST  = +(inv.igstTotal  ?? (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0)).toFixed(2);
const totalTax   = +(totalCGST + totalSGST + totalIGST).toFixed(2);
const salesBase  = +(grandTotal - totalTax).toFixed(2);
const creditSum  = +(totalCGST + totalSGST + totalIGST + salesBase).toFixed(2);

console.log('\nAmount calculation:');
console.log('  grandTotal :', grandTotal);
console.log('  totalCGST  :', totalCGST);
console.log('  totalSGST  :', totalSGST);
console.log('  totalIGST  :', totalIGST);
console.log('  totalTax   :', totalTax);
console.log('  salesBase  :', salesBase);
console.log('  creditSum  :', creditSum);
console.log('  BALANCED   :', Math.abs(grandTotal - creditSum) < 0.01 ? 'YES ✅' : 'NO ❌ diff=' + Math.abs(grandTotal - creditSum));

// Now show what the XML would look like
console.log('\nXML amounts that will be sent to Tally:');
console.log(`  Party debit  : -${grandTotal.toFixed(2)}`);
console.log(`  CGST credit  : +${totalCGST.toFixed(2)}   ledger: Output CGST @ 2.5%`);
console.log(`  SGST credit  : +${totalSGST.toFixed(2)}   ledger: Output SGST @ 2.5%`);
console.log(`  Sales credit : +${salesBase.toFixed(2)}  ledger: Sales Accounts`);
console.log(`  SUM CHECK    : ${(-grandTotal + totalCGST + totalSGST + salesBase).toFixed(4)} (must be 0.0000)`);

await mongoose.disconnect();
