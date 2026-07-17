import connectDB from '../config/database.js';
import AccountsLedger from '../models/AccountsLedger.js';
import Client from '../models/Client.js';
import mongoose from 'mongoose';

await connectDB();

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const names = [
  'Automation Anywhere India Pvt Ltd',
  'GRT JEWELLERS',
  'NATURAL REMEDIES PVT LTD',
];

console.log('\n=== ACCOUNTS LEDGER ===');
for (const name of names) {
  const safe = escapeRegex(name.slice(0, 15));
  const l = await AccountsLedger.findOne({ ledgerName: { $regex: new RegExp(safe, 'i') } }).lean();
  if (l) {
    console.log(`\nFound: ${l.ledgerName}`);
    console.log('  address type:', typeof l.address);
    console.log('  address:', JSON.stringify(l.address));
    console.log('  city:', l.city, '  state:', l.state, '  pincode:', l.pincode);
    console.log('  gstin:', l.gstin || l.gstNumber);
  } else {
    console.log(`NOT FOUND in AccountsLedger: "${name}"`);
  }
}

console.log('\n=== CLIENT ===');
for (const name of names) {
  const safe = escapeRegex(name.slice(0, 15));
  const c = await Client.findOne({ name: { $regex: new RegExp(safe, 'i') } }).lean();
  if (c) {
    console.log(`\nFound: ${c.name}`);
    console.log('  address:', JSON.stringify(c.address));
    console.log('  city:', c.city, '  state:', c.state, '  pincode:', c.pincode);
  } else {
    console.log(`NOT FOUND in Client: "${name}"`);
  }
}

const totalLedgers = await AccountsLedger.countDocuments({});
const totalClients = await Client.countDocuments({});
console.log('\n=== COUNTS ===');
console.log('AccountsLedger total:', totalLedgers);
console.log('Client total:', totalClients);

// Sample one ledger to see what address looks like
const sample = await AccountsLedger.findOne({}).lean();
if (sample) {
  console.log('\n=== SAMPLE LEDGER ===');
  console.log('name:', sample.ledgerName);
  console.log('address type:', typeof sample.address);
  console.log('address:', JSON.stringify(sample.address));
  console.log('city:', sample.city, '  state:', sample.state, '  pincode:', sample.pincode);
}

await mongoose.disconnect();
