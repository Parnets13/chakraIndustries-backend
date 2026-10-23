// hsn-mismatch.js — READ ONLY. For each BIW invoice item, show the HSN stored on
// the invoice line vs the HSN on its ItemMaster vs the item's tallySalesLedger —
// to find why 41 invoices get an HSN mismatch at e-invoice time.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import ItemMaster from './models/ItemMaster.js';

const num = s => parseInt((String(s).match(/(\d+)\s*$/) || [])[1] || '0', 10);

async function main() {
  await connectDB();
  const invs = await Invoice.find({ invoiceNo: /^BIW/i, status: { $ne: 'Cancelled' } },
    'invoiceNo items').lean();
  invs.sort((a, b) => num(a.invoiceNo) - num(b.invoiceNo));

  // Collect all item names to batch-load masters
  const names = [...new Set(invs.flatMap(i => (i.items||[]).map(it => (it.description||it.name||'').trim())).filter(Boolean))];
  const masters = await ItemMaster.find({ name: { $in: names } }, 'name hsn gst tallySalesLedger').lean();
  const mMap = new Map(masters.map(m => [m.name, m]));

  // Group invoices by whether any item's invoice-line HSN differs from its master HSN,
  // or the master HSN is blank.
  let blankCount = 0, diffCount = 0, okCount = 0;
  const examples = [];
  for (const inv of invs) {
    let status = 'ok';
    for (const it of (inv.items||[])) {
      const n = (it.description||it.name||'').trim();
      const m = mMap.get(n);
      const lineHsn = (it.hsn||'').trim();
      const masterHsn = (m?.hsn||'').trim();
      if (!masterHsn && !lineHsn) { status = 'blank'; }
      else if (masterHsn && lineHsn && masterHsn !== lineHsn) { status = 'diff'; break; }
      else if (!status || status==='ok') { if (!masterHsn || !lineHsn) status = 'partial'; }
    }
    if (status === 'blank') blankCount++;
    else if (status === 'diff') diffCount++;
    else okCount++;
    if (examples.length < 15 && status !== 'ok') {
      examples.push({ no: inv.invoiceNo, status, items: (inv.items||[]).map(it => {
        const n=(it.description||it.name||'').trim(); const m=mMap.get(n);
        return `${n.slice(0,24)} [line=${(it.hsn||'').trim()||'-'} master=${(m?.hsn||'').trim()||'-'} ledger=${m?.tallySalesLedger||'-'}]`;
      }) });
    }
  }
  console.log(`Invoices: ok=${okCount} blank=${blankCount} diff=${diffCount}\n`);
  console.log('Examples (non-ok):');
  examples.forEach(e => { console.log(`\n ${e.no} [${e.status}]`); e.items.forEach(x=>console.log('    '+x)); });

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
