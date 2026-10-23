// biw-check.js — READ ONLY. Shows BIW sync status + the latest export run's per-invoice results.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import TallySyncLog from './models/TallySyncLog.js';

const num = s => parseInt((String(s).match(/(\d+)\s*$/) || [])[1] || '0', 10);

async function main() {
  await connectDB();

  // 1) Invoice sync status
  const all = await Invoice.find({ invoiceNo: /^BIW/i, status: { $ne: 'Cancelled' } },
    'invoiceNo tallySync tallyGuid lastError lastTriedAt retryCount').lean();
  all.sort((a, b) => num(a.invoiceNo) - num(b.invoiceNo));
  const synced = all.filter(i => i.tallySync === true);
  console.log('════════════════════════════════════════════');
  console.log(`  BIW total: ${all.length}  |  tallySync=true: ${synced.length}  |  pending: ${all.length - synced.length}`);
  console.log('════════════════════════════════════════════');

  // 2) Latest export run log rows
  const newest = await TallySyncLog.findOne({ syncId: /^EXPORT-SALES/ }).sort({ createdAt: -1 }).lean();
  if (newest) {
    const rows = await TallySyncLog.find({ syncId: newest.syncId }).sort({ createdAt: 1 })
      .select('entity status error records createdAt').lean();
    console.log(`\nLatest run: ${newest.syncId} at ${new Date(newest.createdAt).toISOString().slice(0,19)} — ${rows.length} log row(s)`);
    const ok  = rows.filter(r => /success/i.test(r.status));
    const bad = rows.filter(r => !/success/i.test(r.status));
    console.log(`  ✓ Success rows: ${ok.length}   ✗ Failed rows: ${bad.length}`);
    const byErr = {};
    bad.forEach(r => { const k=(r.error||'(no reason)').slice(0,90); (byErr[k]=byErr[k]||[]).push(r.entity); });
    Object.entries(byErr).sort((a,b)=>b[1].length-a[1].length).forEach(([e,list])=>{
      console.log(`\n  [${list.length}] ${e}`);
      console.log(`      ${list.slice(0,40).join(', ')}${list.length>40?` ...+${list.length-40}`:''}`);
    });
  }

  // 3) Any pending invoices with a recorded error
  const withErr = all.filter(i => !i.tallySync && (i.lastError||'').trim());
  if (withErr.length) {
    console.log('\nPending invoices WITH an error reason:');
    const byErr = {};
    withErr.forEach(i => { const k=(i.lastError||'').slice(0,90); (byErr[k]=byErr[k]||[]).push(i.invoiceNo); });
    Object.entries(byErr).sort((a,b)=>b[1].length-a[1].length).forEach(([e,list])=>{
      console.log(`\n  [${list.length}] ${e}`);
      console.log(`      ${list.slice(0,40).join(', ')}${list.length>40?` ...+${list.length-40}`:''}`);
    });
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
