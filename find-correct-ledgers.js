// find-correct-ledgers.js — READ ONLY. Lists all DISTINCT sales ledgers that are
// already in use by items that HAVE HSN (i.e. confirmed-working ledgers in Tally).
// This tells us which ledger names are safe to map the 6 broken items to.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import ItemMaster from './models/ItemMaster.js';

async function main() {
  await connectDB();
  // Ledgers used by items that already have HSN set (these ledgers work in Tally)
  const withHsn = await ItemMaster.find({ hsn: { $nin: ['', null] } }, 'name tallySalesLedger hsn').lean();
  const ledgerSet = new Map(); // ledger -> example item + hsn
  withHsn.forEach(m => {
    const l = (m.tallySalesLedger||'').trim();
    if (l && !ledgerSet.has(l)) ledgerSet.set(l, { item: m.name, hsn: m.hsn });
  });
  console.log('=== Confirmed-working sales ledgers (used by items with HSN) ===');
  [...ledgerSet.entries()].sort().forEach(([l, ex]) => console.log(`  "${l}"   (e.g. ${ex.item}, hsn ${ex.hsn})`));

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
