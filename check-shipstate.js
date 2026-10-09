// check-shipstate.js — READ ONLY. Shows shipToState for the 20 failed invoices
// to confirm they carry short/invalid state names Tally can't recognise.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

const FAILED = ['BIW2552','BIW2553','BIW2554','BIW2555','BIW2556','BIW2557','BIW2558','BIW2559','BIW2560','BIW2561','BIW2562','BIW2563','BIW2564','BIW2565','BIW2566','BIW2567','BIW2568','BIW2569','BIW2570','BIW2571'];

const VALID_STATES = new Set(['andhra pradesh','arunachal pradesh','assam','bihar','chhattisgarh','goa','gujarat','haryana','himachal pradesh','jharkhand','karnataka','kerala','madhya pradesh','maharashtra','manipur','meghalaya','mizoram','nagaland','odisha','punjab','rajasthan','sikkim','tamil nadu','telangana','tripura','uttar pradesh','uttarakhand','west bengal','delhi','jammu and kashmir','ladakh','chandigarh','puducherry','andaman and nicobar islands','dadra and nagar haveli and daman and diu','lakshadweep']);

async function main() {
  await connectDB();
  const invs = await Invoice.find({ invoiceNo: { $in: FAILED } }).lean();

  console.log('Inv       shipToState        valid?   billToState   igst');
  console.log('─────────────────────────────────────────────────────────');
  let invalidCount = 0;
  for (const inv of invs) {
    const ss = (inv.shipToState || '').trim();
    const valid = VALID_STATES.has(ss.toLowerCase());
    if (!valid) invalidCount++;
    const anyIgst = (inv.items||[]).some(i => +(i.igst||0) > 0);
    console.log(`${inv.invoiceNo}  "${ss}"${' '.repeat(Math.max(0,16-ss.length))}  ${valid?'OK':'INVALID'}   ${(inv.billToState||inv.partyState||'').slice(0,12)}   igst=${anyIgst}`);
  }
  console.log(`\nInvalid/short ship-to state: ${invalidCount} of ${invs.length}`);

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
