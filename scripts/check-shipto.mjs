import 'dotenv/config';
import connectDB from '../config/database.js';
import Invoice from '../models/Invoice.js';

await connectDB();

// Check ship-to fields on first few BIW invoices
const invoices = await Invoice.find(
  { invoiceNo: { $regex: /^BIW/i } },
  { invoiceNo:1, partyName:1, 
    shipToName:1, shipToAddress:1, shipToCity:1, shipToState:1, shipToPincode:1, shipToGST:1,
    billToName:1, billToAddress:1, billToCity:1, billToState:1,
    'tallyVoucher.shipToName':1, 'tallyVoucher.shipToAddress':1,
    _id:0 }
).limit(5).lean();

console.log('Ship-to fields in DB invoices:\n');
for (const inv of invoices) {
  console.log(`--- ${inv.invoiceNo} ---`);
  console.log(`  partyName      : "${inv.partyName}"`);
  console.log(`  shipToName     : "${inv.shipToName || ''}"`);
  console.log(`  shipToAddress  : "${inv.shipToAddress || ''}"`);
  console.log(`  shipToCity     : "${inv.shipToCity || ''}"`);
  console.log(`  shipToState    : "${inv.shipToState || ''}"`);
  console.log(`  shipToPincode  : "${inv.shipToPincode || ''}"`);
  console.log(`  shipToGST      : "${inv.shipToGST || ''}"`);
  console.log(`  tallyVoucher.shipToName: "${inv.tallyVoucher?.shipToName || ''}"`);
  console.log(`  tallyVoucher.shipToAddress: "${inv.tallyVoucher?.shipToAddress || ''}"`);
}

process.exit(0);
