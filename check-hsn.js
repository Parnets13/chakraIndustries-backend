// check-hsn.js — READ ONLY. Checks HSN for the 9 failing items in invoice AND ItemMaster.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import ItemMaster from './models/ItemMaster.js';

async function main() {
  await connectDB();
  const invs = await Invoice.find({ tallySync: { $ne: true } }).lean();
  const names = [...new Set(invs.flatMap(i=>(i.items||[]).map(it=>(it.description||it.name||'').trim())).filter(Boolean))];
  const masters = await ItemMaster.find({ name: { $in: names } }, 'name hsn gst').lean();
  const mMap = new Map(masters.map(m=>[m.name, m]));

  console.log('Item                                        | invoice.hsn | ItemMaster.hsn | ItemMaster.gst');
  console.log('─'.repeat(95));
  const seen = new Set();
  for (const inv of invs) {
    for (const it of (inv.items||[])) {
      const nm = (it.description||it.name||'').trim();
      if (seen.has(nm)) continue; seen.add(nm);
      const m = mMap.get(nm);
      console.log(`${nm.slice(0,43).padEnd(43)} | "${(it.hsn||'').toString()}"${' '.repeat(Math.max(0,10-(it.hsn||'').length))} | "${(m?.hsn||'')}"${' '.repeat(Math.max(0,13-(m?.hsn||'').length))} | ${m?.gst ?? 'N/A'}`);
    }
  }
  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
