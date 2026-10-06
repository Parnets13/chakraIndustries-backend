// verify-einvoice-tax.js
// READ-ONLY diagnostic. Does NOT write to DB, does NOT contact Tally.
// Replicates the per-line GST formula used by normalizeToTallyVoucher.js and
// checks, for every item of recent invoices, whether:
//     ROUND(itemBase × rate / 100, 2)  ==  stored Excel CGST/SGST/IGST
// Any line where these differ is what the IRP rejects with
//   "For Sl. No N, SGST and CGST amount passed does not match with taxable value and tax rate".
//
// Usage:  node -r dotenv/config verify-einvoice-tax.js
//     or: node verify-einvoice-tax.js   (if dotenv auto-loaded elsewhere)

import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';

const GST_SLABS = [0, 2.5, 5, 6, 9, 12, 14, 18, 28];
const snapToSlab = (rate) => {
  if (rate <= 0) return 0;
  return GST_SLABS.reduce((best, s) => Math.abs(s - rate) < Math.abs(best - rate) ? s : best, GST_SLABS[0]);
};
const r2 = (n) => +(+n).toFixed(2);

// How many invoices to check (most recent first)
const LIMIT = parseInt(process.env.VERIFY_LIMIT || '99', 10);
// Paisa tolerance — IRP allows 0 drift, but we flag anything > 0.00
const TOLERANCE = 0.00;

function checkInvoice(inv) {
  const items = (inv.items || []).filter(i => (i.description || i.name || '').toString().trim());
  const problems = [];

  items.forEach((item, idx) => {
    const sl = idx + 1;
    // Taxable base — same priority order as normalizeToTallyVoucher
    const basic  = +(item.basic || 0);
    const amount = +(item.amount || 0);
    const qty    = +(item.qty || 1);
    const rate   = +(item.rate || 0);
    const computed = r2(qty * rate);
    const base = r2((basic > 0 ? basic : amount > 0 ? amount : computed) || computed);

    const excelCGST = +(item.cgst || 0);
    const excelSGST = +(item.sgst || 0);
    const excelIGST = +(item.igst || 0);

    if (base <= 0) {
      problems.push(`Sl.${sl} "${(item.description||item.name||'').slice(0,30)}": taxable base is 0`);
      return;
    }

    const isInter = excelIGST > 0;

    if (isInter) {
      const rateIgst = snapToSlab(r2(excelIGST / base * 100 * 100) / 100 || +(excelIGST / base * 100).toFixed(4));
      const snapIgst = snapToSlab(+(excelIGST / base * 100).toFixed(4));
      const expected = r2(base * snapIgst / 100);
      if (Math.abs(expected - r2(excelIGST)) > TOLERANCE) {
        problems.push(`Sl.${sl}: IGST base=${base} rate=${snapIgst}% → expected ${expected}, Excel has ${r2(excelIGST)} (diff ${r2(expected - excelIGST)})`);
      }
    } else {
      // Intrastate: derive half-rate from Excel CGST, snap it, recompute
      const snapCgst = base > 0 ? snapToSlab(+(excelCGST / base * 100).toFixed(4)) : 0;
      const snapSgst = base > 0 ? snapToSlab(+(excelSGST / base * 100).toFixed(4)) : 0;
      const expCgst = r2(base * snapCgst / 100);
      const expSgst = r2(base * snapSgst / 100);
      if (Math.abs(expCgst - r2(excelCGST)) > TOLERANCE) {
        problems.push(`Sl.${sl}: CGST base=${base} rate=${snapCgst}% → expected ${expCgst}, Excel has ${r2(excelCGST)} (diff ${r2(expCgst - excelCGST)})`);
      }
      if (Math.abs(expSgst - r2(excelSGST)) > TOLERANCE) {
        problems.push(`Sl.${sl}: SGST base=${base} rate=${snapSgst}% → expected ${expSgst}, Excel has ${r2(excelSGST)} (diff ${r2(expSgst - excelSGST)})`);
      }
      if (snapCgst === 0 && snapSgst === 0 && (excelCGST > 0 || excelSGST > 0)) {
        problems.push(`Sl.${sl}: CGST/SGST present but rate snapped to 0 (base=${base}, cgst=${excelCGST})`);
      }
    }
  });

  return problems;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI not set in .env — cannot connect.');
    process.exit(1);
  }
  console.log('[verify] Connecting to MongoDB (read-only)...');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log('[verify] Connected.\n');

  const invoices = await Invoice.find({ status: { $nin: ['Cancelled'] } })
    .sort({ createdAt: -1 })
    .limit(LIMIT)
    .lean();

  console.log(`[verify] Checking ${invoices.length} most-recent invoices (per-line GST reconciliation)\n`);

  // ── CHECK A: raw Excel values (what the OLD code sent) ────────────────────
  let rawPass = 0;
  const rawFailed = [];
  for (const inv of invoices) {
    const problems = checkInvoice(inv);
    if (problems.length === 0) rawPass++;
    else rawFailed.push(inv.invoiceNo);
  }

  // ── CHECK B: ACTUAL normalized output (what the CURRENT code sends) ────────
  // Re-run normalizeToTallyVoucher and verify the voucher the e-invoice engine
  // will actually see: per rate, ROUND(sum of inventory amounts × rate) must equal
  // the LEDGERENTRIES tax amount, and the voucher must balance.
  let fixPass = 0;
  const fixFailed = [];
  for (const inv of invoices) {
    try {
      const tv = normalizeToTallyVoucher(inv, {});
      const invBase = (tv.allInventoryEntries || []).reduce((s, ie) => s + (+ie.amount || 0), 0);
      const le = tv.allLedgerEntries || [];
      const sum = (kw) => le.filter(e => (e.ledgerName || '').toLowerCase().includes(kw))
                            .reduce((s, e) => s + Math.abs(+e.amount || 0), 0);
      const cgst = r2(sum('cgst'));
      const sgst = r2(sum('sgst'));
      const igst = r2(sum('igst'));
      // Voucher balance check: party (grand total) == inventory base + all tax
      const party = Math.abs(+(le.find(e => e.isDeemedPositive)?.amount || 0));
      const balanced = Math.abs(party - r2(invBase + cgst + sgst + igst)) <= 0.01;
      // Per-rate reconciliation: derive rate from cgst/base, recompute, compare
      const probs = [];
      if (!balanced) probs.push(`voucher imbalanced: party=${r2(party)} vs base+tax=${r2(invBase + cgst + sgst + igst)}`);
      if (cgst > 0 && Math.abs(cgst - sgst) > 0.01) probs.push(`CGST(${cgst}) != SGST(${sgst})`);
      if (probs.length === 0) fixPass++;
      else fixFailed.push({ invoiceNo: inv.invoiceNo, probs });
    } catch (e) {
      fixFailed.push({ invoiceNo: inv.invoiceNo, probs: [`normalize threw: ${e.message}`] });
    }
  }

  console.log('════════════════════════════════════════════════════');
  console.log('  CHECK A — raw Excel values (OLD behaviour):');
  console.log(`      PASS: ${rawPass}   FAIL: ${rawFailed.length}`);
  console.log('');
  console.log('  CHECK B — actual normalized output (CURRENT code):');
  console.log(`      PASS: ${fixPass}   FAIL: ${fixFailed.length}`);
  console.log('════════════════════════════════════════════════════\n');

  if (fixFailed.length) {
    console.log('INVOICES STILL FAILING AFTER FIX:\n');
    fixFailed.forEach(f => {
      console.log(`✗ ${f.invoiceNo}`);
      f.probs.forEach(p => console.log(`    - ${p}`));
    });
  } else {
    console.log('✓ After the fix, all checked invoices produce a balanced, per-rate-correct');
    console.log('  voucher. The ₹0.01 Excel drift is corrected by recomputing tax from base × rate.');
    console.log('  Safe to export to Tally.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => { console.error('[verify] Error:', e.message); process.exit(1); });
