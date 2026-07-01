/**
 * debug-shipto.js
 * Run: node scripts/debug-shipto.js
 * Shows shipTo fields for recent Sales vouchers from MongoDB
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

const TallyVoucherSchema = new mongoose.Schema({}, { strict: false });
const TallyVoucher = mongoose.model('TallyVoucher', TallyVoucherSchema, 'tallyvouchers');

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB\n');

  // Find the Reward360 invoice or any recent Sales voucher
  const vouchers = await TallyVoucher.find({
    voucherType: 'Sales',
    $or: [
      { partyName: /reward360/i },
      { voucherNumber: 'SCI01266' }
    ]
  }).limit(5).lean();

  if (vouchers.length === 0) {
    console.log('No matching vouchers found. Showing last 3 Sales vouchers instead:\n');
    const recent = await TallyVoucher.find({ voucherType: 'Sales' })
      .sort({ voucherDate: -1 }).limit(3).lean();
    recent.forEach(v => printShipTo(v));
  } else {
    vouchers.forEach(v => printShipTo(v));
  }

  await mongoose.disconnect();
}

function printShipTo(v) {
  console.log('='.repeat(60));
  console.log(`Voucher : ${v.voucherNumber}`);
  console.log(`Party   : ${v.partyName}`);
  console.log(`Date    : ${v.voucherDate}`);
  console.log('--- Bill To ---');
  console.log(`  billToName        : ${JSON.stringify(v.billToName)}`);
  console.log(`  billToMailingName : ${JSON.stringify(v.billToMailingName)}`);
  console.log(`  billToAddress     : ${JSON.stringify(v.billToAddress)}`);
  console.log(`  billToGST         : ${JSON.stringify(v.billToGST)}`);
  console.log('--- Ship To ---');
  console.log(`  shipToName        : ${JSON.stringify(v.shipToName)}`);
  console.log(`  shipToMailingName : ${JSON.stringify(v.shipToMailingName)}`);
  console.log(`  shipToAddress     : ${JSON.stringify(v.shipToAddress)}`);
  console.log(`  shipToGST         : ${JSON.stringify(v.shipToGST)}`);
  console.log(`  shipToState       : ${JSON.stringify(v.shipToState)}`);
  console.log('');
}

main().catch(console.error);
