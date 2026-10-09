// list-invalid-states.js — READ ONLY. Lists ALL invoices (of the current set)
// whose shipToState is not a valid full Indian state name Tally recognises.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

const VALID = new Set(['andhra pradesh','arunachal pradesh','assam','bihar','chhattisgarh','goa','gujarat','haryana','himachal pradesh','jharkhand','karnataka','kerala','madhya pradesh','maharashtra','manipur','meghalaya','mizoram','nagaland','odisha','punjab','rajasthan','sikkim','tamil nadu','telangana','tripura','uttar pradesh','uttarakhand','west bengal','delhi','jammu and kashmir','ladakh','chandigarh','puducherry','andaman and nicobar islands','dadra and nagar haveli and daman and diu','lakshadweep']);

async function main() {
  await connectDB();
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).sort({ invoiceNo: 1 }).lean();

  const bad = [];
  for (const inv of invs) {
    const ss = (inv.shipToState || '').trim();
    if (ss && !VALID.has(ss.toLowerCase())) {
      bad.push({ no: inv.invoiceNo, state: ss, ship: inv.shipToName || '', city: inv.shipToCity || '' });
    }
  }

  console.log(`Total invoices: ${invs.length}`);
  console.log(`Invoices with INVALID ship-to state: ${bad.length}\n`);
  console.log('Invoice No    Ship-to State (as in Excel)    Ship-to City');
  console.log('──────────────────────────────────────────────────────────');
  bad.forEach(b => console.log(`${b.no}    "${b.state}"${' '.repeat(Math.max(0,10-b.state.length))}    ${b.city}`));

  console.log('\n── Just the invoice numbers ──');
  console.log(bad.map(b => b.no).join(', '));

  console.log('\n── Distinct invalid state codes found ──');
  const codes = [...new Set(bad.map(b => b.state))];
  console.log(codes.join(', '));

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
