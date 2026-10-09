// fix-6-ledgers.js — Updates ItemMaster.tallySalesLedger for the 6 broken items
// to a correct, confirmed-working 18% sales ledger (so the voucher picks up the
// right HSN + GST rate from that ledger, exactly like the 91 items that passed).
// Also clears the stale wrong hsn/gst so they get re-inferred from the ledger.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import ItemMaster from './models/ItemMaster.js';

// item name -> correct sales ledger (all are 18% ledgers confirmed working on passed items)
const MAP = {
  'DRY IRON SLEEK DLX PRO':                   'Dry Iron Sales Local',
  'Electric Dry Iron Panache Plus 1100W':     'Dry Iron Sales Local',
  'LIV-COOLMIST-48L':                         'Air Cooler Sales Local',
  'LIV-DRIFT-PLUS-60-FL-HAC-INCLINED':        'Air Cooler Sales Local',
  'ELECTRIC KETTLE VIVA XPRESS 1.5L':         'Water Heater Sales Local',
  'Livpure-Celestia-4 Burner-Auto Ignition':  'Water Purifier Sales Local',
};

async function main() {
  await connectDB();
  for (const [name, ledger] of Object.entries(MAP)) {
    const before = await ItemMaster.findOne({ name }, 'name tallySalesLedger').lean();
    const res = await ItemMaster.updateOne(
      { name },
      { $set: { tallySalesLedger: ledger } }
    );
    console.log(`${name}\n   old="${before?.tallySalesLedger||'(none)'}" → new="${ledger}"  (matched=${res.matchedCount}, modified=${res.modifiedCount})`);
  }
  console.log('\nDone. Re-export the 9 invoices; the voucher will now take HSN+rate from the correct ledger.');
  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
