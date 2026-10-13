// preflight-all.js — READ ONLY. Scans ALL pending invoices and reports, per invoice,
// every condition that will cause a Tally problem: missing HSN source, wrong/missing
// sales ledger, missing qty/rate, missing GST rate. One complete picture.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import ItemMaster from './models/ItemMaster.js';

const r2 = n => +(+n).toFixed(2);
const GENERIC = new Set(['', 'sales', 'sales accounts', 'sales accounts (group)']);

async function main() {
  await connectDB();

  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).lean();
  const names = [...new Set(invs.flatMap(i => (i.items||[]).map(it => (it.description||it.name||'').trim())).filter(Boolean))];
  const masters = await ItemMaster.find({ name: { $in: names } }, 'name hsn gst tallySalesLedger').lean();
  const mMap = new Map(masters.map(m => [m.name, m]));

  // Which sales ledgers are "known good" (used by items that have an HSN)?
  const goodLedgers = new Set(masters.filter(m => (m.hsn||'').trim()).map(m => (m.tallySalesLedger||'').trim()).filter(Boolean));

  let clean = 0;
  const problems = [];

  for (const inv of invs) {
    const issues = [];
    for (const it of (inv.items || [])) {
      const n = (it.description || it.name || '').trim();
      if (!n) { issues.push('item with no name'); continue; }
      const im = mMap.get(n);
      const invLedger = (it.tallySalesLedger || '').trim();
      const imLedger  = (im?.tallySalesLedger || '').trim();
      const ledger    = invLedger || imLedger;
      const hsn       = (it.hsn || '').trim() || (im?.hsn || '').trim();
      const qty       = +(it.qty || 0);
      const rate      = +(it.rate || 0);
      const base      = +(it.basic || it.amount || 0);
      const tax       = (+(it.cgst||0)) + (+(it.sgst||0)) + (+(it.igst||0));

      if (GENERIC.has(ledger.toLowerCase())) issues.push(`${n}: NO sales ledger`);
      else if (!goodLedgers.has(ledger)) issues.push(`${n}: ledger "${ledger}" has no HSN in master (HSN will be blank)`);
      if (!hsn && !GENERIC.has(ledger.toLowerCase()) && !goodLedgers.has(ledger)) issues.push(`${n}: HSN missing`);
      if (qty <= 0) issues.push(`${n}: qty=${qty} (qty/rate may be blank in Tally)`);
      if (rate <= 0 && base <= 0) issues.push(`${n}: no rate and no amount`);
      if (tax <= 0) issues.push(`${n}: no tax`);
    }
    if (issues.length === 0) clean++;
    else problems.push({ no: inv.invoiceNo, issues });
  }

  console.log('════════════════════════════════════════════════');
  console.log(`  Total invoices:        ${invs.length}`);
  console.log(`  CLEAN (will export):   ${clean}`);
  console.log(`  WITH PROBLEMS:         ${problems.length}`);
  console.log('════════════════════════════════════════════════\n');

  // Group problems by type for a quick summary
  const byType = {};
  problems.forEach(p => p.issues.forEach(i => {
    const type = i.includes('NO sales ledger') ? 'No sales ledger'
      : i.includes('has no HSN') ? 'Ledger has no HSN'
      : i.includes('HSN missing') ? 'HSN missing'
      : i.includes('qty=') ? 'Qty/Rate blank'
      : i.includes('no rate') ? 'No rate/amount'
      : i.includes('no tax') ? 'No tax' : 'Other';
    byType[type] = (byType[type] || 0) + 1;
  }));
  console.log('PROBLEM SUMMARY (by type):');
  Object.entries(byType).forEach(([t,c]) => console.log(`  ${t}: ${c} item-lines`));

  console.log('\nPER-INVOICE PROBLEMS:');
  problems.slice(0, 60).forEach(p => {
    console.log(`\n  ✗ ${p.no}`);
    [...new Set(p.issues)].forEach(i => console.log(`      - ${i}`));
  });

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
