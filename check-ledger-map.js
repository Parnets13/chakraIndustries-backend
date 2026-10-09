// check-ledger-map.js — READ ONLY. Compares tallySalesLedger of the 6 failing items
// vs items that passed (which have HSN). Shows whether passed items have a CORRECT
// sales ledger (that carries HSN+rate in Tally) and failing ones have a wrong/missing one.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import ItemMaster from './models/ItemMaster.js';

const FAIL = ['Livpure-Celestia-4 Burner-Auto Ignition','LIV-COOLMIST-48L','LIV-DRIFT-PLUS-60-FL-HAC-INCLINED','DRY IRON SLEEK DLX PRO','Electric Dry Iron Panache Plus 1100W','ELECTRIC KETTLE VIVA XPRESS 1.5L'];

async function main() {
  await connectDB();
  console.log('=== FAILING 6 items: tallySalesLedger ===');
  const fail = await ItemMaster.find({ name: { $in: FAIL } }, 'name hsn gst tallySalesLedger').lean();
  fail.forEach(m => console.log(`  "${m.name}"\n     ledger="${m.tallySalesLedger||'(empty)'}" hsn="${m.hsn||''}" gst=${m.gst}`));

  console.log('\n=== PASSED items (have HSN): their tallySalesLedger ===');
  const good = await ItemMaster.find({ hsn: { $nin: ['', null] } }, 'name hsn gst tallySalesLedger').limit(12).lean();
  good.forEach(m => console.log(`  "${m.name}"\n     ledger="${m.tallySalesLedger||'(empty)'}" hsn="${m.hsn}" gst=${m.gst}`));

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
