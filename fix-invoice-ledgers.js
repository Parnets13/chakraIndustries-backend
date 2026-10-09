// fix-invoice-ledgers.js — Fixes the stored tallySalesLedger INSIDE the 9 pending
// invoices' items (not just ItemMaster), since export reads the invoice's stored
// ledger first. Maps each item to its correct 18% sales ledger.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

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
  const invs = await Invoice.find({ tallySync: { $ne: true } });
  let fixed = 0;
  for (const inv of invs) {
    let changed = false;
    (inv.items || []).forEach(it => {
      const n = (it.description || it.name || '').trim();
      if (MAP[n] && it.tallySalesLedger !== MAP[n]) {
        console.log(`${inv.invoiceNo}: "${n}" ledger "${it.tallySalesLedger||'(none)'}" → "${MAP[n]}"`);
        it.tallySalesLedger = MAP[n];
        changed = true;
      }
    });
    if (changed) {
      inv.markModified('items');
      await inv.save();
      fixed++;
    }
  }
  console.log(`\nFixed ${fixed} invoices. Re-export now.`);
  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
