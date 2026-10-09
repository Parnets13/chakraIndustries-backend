// why-only-9.js — READ ONLY. Answers: why do ONLY these 9 fail when everything else worked?
// Checks whether these 9 items EVER successfully synced before (have a tallyGuid in archive),
// and whether the SAME item name appears in any PASSED invoice.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import ItemMaster from './models/ItemMaster.js';
import StockInvoiceArchive from './models/StockInvoiceArchive.js';

async function main() {
  await connectDB();

  const failed = await Invoice.find({ tallySync: { $ne: true } }).lean();
  const failItems = [...new Set(failed.flatMap(f=>(f.items||[]).map(it=>(it.description||it.name||'').trim())).filter(Boolean))];

  console.log('The 9 failing invoices use these', failItems.length, 'unique items:');
  failItems.forEach(n => console.log('  -', n));

  // Did any of these item names EVER sync successfully (tallyGuid present) in the archive?
  console.log('\n=== Did these items EVER sync successfully before? (archive with tallyGuid) ===');
  const arch = await StockInvoiceArchive.find({}).lean();
  for (const name of failItems) {
    let everSynced = false, everAppeared = 0;
    for (const a of arch) {
      const inv = a.invoice || a;
      const items = inv.items || a.items || [];
      const has = items.some(it => (it.description||it.name||'').trim() === name);
      if (has) {
        everAppeared++;
        if (inv.tallyGuid || a.tallyGuid) everSynced = true;
      }
    }
    console.log(`  "${name}": appeared ${everAppeared}× in archive, everSyncedWithGuid=${everSynced}`);
  }

  // Compare ItemMaster completeness: these 9 items vs a few items that DID sync
  console.log('\n=== ItemMaster data for the 9 failing items ===');
  const masters = await ItemMaster.find({ name: { $in: failItems } }, 'name hsn gst tallySalesLedger createdAt').lean();
  masters.forEach(m => console.log(`  "${m.name}" | hsn="${m.hsn||''}" | gst=${m.gst} | ledger="${m.tallySalesLedger||''}" | created=${m.createdAt?new Date(m.createdAt).toISOString().slice(0,10):'?'}`));

  console.log('\n=== A few OTHER ItemMaster items (that presumably synced fine) with HSN set ===');
  const good = await ItemMaster.find({ hsn: { $exists: true, $nin: ['', null] } }, 'name hsn gst').limit(10).lean();
  good.forEach(m => console.log(`  "${m.name}" | hsn="${m.hsn}" | gst=${m.gst}`));

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
