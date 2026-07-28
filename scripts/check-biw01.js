import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const inv = await Invoice.findOne({ invoiceNo: 'BIW01' }).lean();
if (inv) {
  console.log('=== INVOICE BIW01 ===');
  console.log('shipToName   :', JSON.stringify(inv.shipToName));
  console.log('shipToAddress:', JSON.stringify(inv.shipToAddress));
  console.log('shipToState  :', JSON.stringify(inv.shipToState));
  console.log('billToState  :', JSON.stringify(inv.billToState));
  console.log('partyState   :', JSON.stringify(inv.partyState));
  const tv = inv.tallyVoucher;
  if (tv) {
    console.log('--- tallyVoucher ---');
    console.log('tv.shipToName   :', JSON.stringify(tv.shipToName));
    console.log('tv.shipToState  :', JSON.stringify(tv.shipToState));
    console.log('tv.shipToAddress:', JSON.stringify(tv.shipToAddress));
    console.log('tv.billToState  :', JSON.stringify(tv.billToState));
    console.log('tv.partyState   :', JSON.stringify(tv.partyState));
  } else {
    console.log('tallyVoucher: NULL');
  }
} else {
  console.log('BIW01 NOT FOUND in DB');
}
await mongoose.disconnect();
