import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);

const pending = await Invoice.find({
  status:    { $nin: ['Cancelled'] },
  source:    { $nin: ['Tally', 'tally'] },
  tallySync: { $ne: true },
}).lean();

console.log('Pending invoices count:', pending.length);

const rateGroups = {};
for (const inv of pending) {
  const cgst = +(inv.cgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0));
  const sgst = +(inv.sgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0));
  const igst = +(inv.igstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0));
  const base = +((inv.grandTotal||0) - cgst - sgst - igst);
  const cgstRate = (base > 0 && cgst > 0) ? +((cgst/base)*100).toFixed(1) : 0;
  const key = `cgst@${cgstRate}% igst@${igst>0?+((igst/base)*100).toFixed(1)+'%':'0%'}`;
  rateGroups[key] = (rateGroups[key]||[]);
  rateGroups[key].push({ no: inv.invoiceNo, party: inv.partyName, gt: inv.grandTotal });
}

for (const [rate, items] of Object.entries(rateGroups)) {
  console.log(`\n${rate} (${items.length} invoices):`);
  items.slice(0,5).forEach(i => console.log(`  ${i.no} | ${i.party} | ₹${i.gt}`));
  if (items.length > 5) console.log(`  ...and ${items.length - 5} more`);
}

await mongoose.disconnect();
