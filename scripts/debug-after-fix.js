import connectDB from '../config/database.js';
import TallyVoucher from '../models/TallyVoucher.js';
import mongoose from 'mongoose';

await connectDB();

const vouchers = await TallyVoucher.find({ voucherType: 'Sales' })
  .sort({ createdAt: -1 }).limit(5).lean();

for (const v of vouchers) {
  console.log('\n=== VOUCHER:', v.voucherNumber, '===');
  console.log('partyName     :', v.partyName);
  console.log('billToAddress :', JSON.stringify(v.billToAddress));
  console.log('billToCity    :', v.billToCity);
  console.log('billToState   :', v.billToState);
  console.log('billToPincode :', JSON.stringify(v.billToPincode));
}

// Count how many have blank address
const total   = await TallyVoucher.countDocuments({ voucherType: 'Sales' });
const blank   = await TallyVoucher.countDocuments({ voucherType: 'Sales', $or: [{ billToAddress: '' }, { billToAddress: { $exists: false } }] });
const noPin   = await TallyVoucher.countDocuments({ voucherType: 'Sales', $or: [{ billToPincode: '' }, { billToPincode: { $exists: false } }] });
console.log(`\nTotal Sales vouchers: ${total}`);
console.log(`Blank billToAddress : ${blank}`);
console.log(`Blank billToPincode : ${noPin}`);

await mongoose.disconnect();
