// check-automaster-rate.js — READ ONLY. Confirms the Excel-derived GST rate (18%)
// is available for the 9 items, so the auto-masters step will set/keep 18% in Tally.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

const FAILED = ['BIW2560','BIW2565','BIW2567','BIW2568','BIW2569','BIW2570','BIW2571','BIW2629','BIW2630'];

async function main() {
  await connectDB();
  const invs = await Invoice.find({ invoiceNo: { $in: FAILED } }).lean();

  // Replicate stockGstRateMap logic from exportSalesInvoices
  const stockGstRateMap = new Map();
  for (const inv of invs) {
    for (const item of (inv.items || [])) {
      const name = (item.description || item.name || '').trim();
      if (!name || stockGstRateMap.has(name)) continue;
      let rate = +(item.taxRate || 0);
      if (!rate) {
        const tax = (+(item.cgst||0)) + (+(item.sgst||0)) + (+(item.igst||0));
        const base = +(item.basic||0) || (+(item.qty||1) * +(item.rate||0));
        if (tax > 0 && base > 0) rate = Math.round((tax / base) * 100 * 2) / 2;
      }
      if (rate > 0) stockGstRateMap.set(name, rate);
    }
  }

  console.log('Item                                       → auto-masters GST rate it will push to Tally');
  console.log('─'.repeat(90));
  for (const [name, rate] of stockGstRateMap) {
    console.log(`${name.slice(0,42).padEnd(42)} → ${rate}%  ${rate>0?'✓ will set/keep in Tally master':'✗ ZERO — would mismatch'}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
