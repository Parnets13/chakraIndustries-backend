import connectDB from '../config/database.js';
import TallyVoucher from '../models/TallyVoucher.js';
import mongoose from 'mongoose';

await connectDB();

// Get the 3 most recent Sales vouchers
const vouchers = await TallyVoucher.find({ voucherType: 'Sales' })
  .sort({ createdAt: -1 })
  .limit(3)
  .lean();

if (!vouchers.length) {
  console.log('No Sales vouchers found in MongoDB');
} else {
  for (const v of vouchers) {
    console.log('\n=== VOUCHER:', v.voucherNumber, '===');
    console.log('partyName      :', v.partyName);
    console.log('billToName     :', v.billToName);
    console.log('billToAddress  :', JSON.stringify(v.billToAddress));
    console.log('billToCity     :', v.billToCity);
    console.log('billToState    :', v.billToState);
    console.log('billToPincode  :', JSON.stringify(v.billToPincode));
    console.log('billToGST      :', v.billToGST);
    console.log('partyGstin     :', v.partyGstin);
    console.log('ALL SCHEMA KEYS:', Object.keys(v).filter(k => !k.startsWith('_') && k !== '__v').join(', '));
  }
}

await mongoose.disconnect();
