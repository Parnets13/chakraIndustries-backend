import connectDB from '../config/database.js';
import TallyVoucher from '../models/TallyVoucher.js';
import AccountsLedger from '../models/AccountsLedger.js';
import mongoose from 'mongoose';

await connectDB();

// Get vouchers with blank address but have GSTIN
const vouchers = await TallyVoucher.find({
  voucherType: 'Sales',
  $or: [{ billToAddress: '' }, { billToAddress: { $exists: false } }],
  partyGstin: { $nin: ['', null, undefined] }
}).limit(5).lean();

console.log(`Vouchers with blank address but have GSTIN: ${vouchers.length}`);

for (const v of vouchers) {
  console.log('\n--- Voucher:', v.voucherNumber, '---');
  console.log('partyGstin:', v.partyGstin);
  
  // Try matching by GSTIN in AccountsLedger
  const ledger = await AccountsLedger.findOne({
    $or: [
      { gstNumber: v.partyGstin },
      { gstin: v.partyGstin },
      { 'gstDetails.gstin': v.partyGstin }
    ]
  }).lean();
  
  if (ledger) {
    console.log('FOUND ledger by GSTIN:', ledger.ledgerName);
    console.log('  address:', JSON.stringify(ledger.address));
    console.log('  city:', ledger.city, ' state:', ledger.state, ' pincode:', ledger.pincode);
    const addrObj = ledger.address || {};
    console.log('  address.street:', addrObj.street);
    console.log('  address.city:', addrObj.city);
    console.log('  address.state:', addrObj.state);
    console.log('  address.pincode:', addrObj.pincode);
  } else {
    console.log('NOT found in AccountsLedger by GSTIN');
    // Try by name
    const byName = await AccountsLedger.findOne({ ledgerName: v.partyName }).lean();
    if (byName) {
      console.log('FOUND by name:', byName.ledgerName);
      console.log('  address:', JSON.stringify(byName.address));
    } else {
      console.log('NOT found by name either');
    }
  }
}

// Summary: how many AccountsLedger records have any address data
const total = await AccountsLedger.countDocuments({});
const hasStreet = await AccountsLedger.countDocuments({ 'address.street': { $exists: true, $ne: '' } });
const hasCity = await AccountsLedger.countDocuments({ 'address.city': { $exists: true, $ne: '' } });
const hasPincode = await AccountsLedger.countDocuments({ 'address.pincode': { $exists: true, $ne: '' } });
const hasGstin = await AccountsLedger.countDocuments({ gstNumber: { $exists: true, $ne: '' } });

console.log('\n=== AccountsLedger stats ===');
console.log('Total:', total);
console.log('Has address.street:', hasStreet);
console.log('Has address.city:', hasCity);
console.log('Has address.pincode:', hasPincode);
console.log('Has gstNumber:', hasGstin);

await mongoose.disconnect();
