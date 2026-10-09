// check-synced-flag.js — READ ONLY. Shows whether the 6 failing items were ever
// synced FROM Tally (tallySynced flag + tallyGuid), vs items that have HSN.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import ItemMaster from './models/ItemMaster.js';

const FAIL = ['Livpure-Celestia-4 Burner-Auto Ignition','LIV-COOLMIST-48L','LIV-DRIFT-PLUS-60-FL-HAC-INCLINED','DRY IRON SLEEK DLX PRO','Electric Dry Iron Panache Plus 1100W','ELECTRIC KETTLE VIVA XPRESS 1.5L'];

async function main() {
  await connectDB();
  const items = await ItemMaster.find({ name: { $in: FAIL } },
    'name hsn gst tallySynced tallyGuid dataSource lastTallySync').lean();
  console.log('=== The 6 failing items — sync status ===');
  items.forEach(m => console.log(
    `"${m.name}"\n   hsn="${m.hsn||''}" gst=${m.gst} tallySynced=${m.tallySynced} guid=${m.tallyGuid?'YES':'no'} dataSource=${m.dataSource||'?'} lastSync=${m.lastTallySync?new Date(m.lastTallySync).toISOString().slice(0,10):'never'}`
  ));

  console.log('\n=== Compare: items WITH hsn — are they tallySynced? ===');
  const good = await ItemMaster.find({ hsn: { $nin: ['', null] } },
    'name hsn tallySynced tallyGuid').limit(5).lean();
  good.forEach(m => console.log(`"${m.name}" hsn="${m.hsn}" tallySynced=${m.tallySynced} guid=${m.tallyGuid?'YES':'no'}`));

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
