/**
 * dump-gst-mismatch.js
 * ─────────────────────
 * Shows EXACTLY what RATEDETAILS rates we are sending vs what LEDGERENTRIES amounts
 * we are sending — so we can see the mismatch Tally sees.
 *
 * Usage:
 *   node scripts/dump-gst-mismatch.js            ← uses most recent unsynced invoice
 *   node scripts/dump-gst-mismatch.js BIW123      ← specific invoice number
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ DB connected\n');

const targetNo = process.argv[2] || null;

const query = targetNo
  ? { invoiceNo: targetNo }
  : { status: { $nin: ['Cancelled'] }, source: { $nin: ['Tally','tally'] } };

const inv = await Invoice.findOne(query).sort({ createdAt: -1 }).lean();
if (!inv) { console.error('❌ No invoice found'); process.exit(1); }

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();

console.log('═══════════════════════════════════════════════');
console.log('INVOICE:', inv.invoiceNo, '|', inv.partyName);
console.log('═══════════════════════════════════════════════');

// ── Raw invoice fields ────────────────────────────────────────────────────────
console.log('\n📄 RAW INVOICE FIELDS:');
console.log('  grandTotal  :', inv.grandTotal);
console.log('  cgstTotal   :', inv.cgstTotal);
console.log('  sgstTotal   :', inv.sgstTotal);
console.log('  igstTotal   :', inv.igstTotal);
console.log('  totalAmount :', inv.totalAmount);

console.log('\n📦 ITEMS:');
for (const it of (inv.items || [])) {
  console.log(`  - "${it.description || it.name}"`);
  console.log(`      qty=${it.qty||1}  rate=${it.rate||0}  basic=${it.basic||'(none)'}  amount=${it.amount||'(none)'}  total=${it.total||'(none)'}`);
  console.log(`      cgst=${it.cgst||0}  sgst=${it.sgst||0}  igst=${it.igst||0}  taxRate=${it.taxRate||'(none)'}`);
  console.log(`      tallySalesLedger="${it.tallySalesLedger||'(empty)'}"`);
}

// ── Enrich with ItemMaster ────────────────────────────────────────────────────
const itemNames = [...new Set((inv.items||[]).map(i=>(i.description||i.name||'').trim()).filter(Boolean))];
const masters = itemNames.length ? await ItemMaster.find({ name: { $in: itemNames } }, 'name hsn gst tallySalesLedger').lean() : [];
const masterMap = new Map(masters.map(m => [m.name, m]));

const enrichedItems = (inv.items || []).map(item => {
  const n = (item.description || item.name || '').trim();
  const im = masterMap.get(n);
  return {
    ...item,
    hsn:              (item.hsn || '').trim()              || (im?.hsn              || '').trim(),
    tallySalesLedger: (item.tallySalesLedger || '').trim() || (im?.tallySalesLedger || '').trim(),
    taxRate:          item.taxRate || im?.gst || 0,
  };
});

console.log('\n📦 ENRICHED ITEMS (after ItemMaster lookup):');
for (const it of enrichedItems) {
  console.log(`  - "${it.description || it.name}": tallySalesLedger="${it.tallySalesLedger||'(empty)'}" hsn="${it.hsn||'(none)'}" taxRate=${it.taxRate||0}`);
}

// ── Normalize ─────────────────────────────────────────────────────────────────
const tv = normalizeToTallyVoucher(
  { ...inv, items: enrichedItems },
  { salesVoucherTypeName: 'Sales' }
);

console.log('\n💰 NORMALIZED AMOUNTS:');
console.log('  _grandTotal :', tv._grandTotal);
console.log('  _salesBase  :', tv._salesBase);
console.log('  _totalCGST  :', tv._totalCGST);
console.log('  _totalSGST  :', tv._totalSGST);
console.log('  _totalIGST  :', tv._totalIGST);

console.log('\n📋 LEDGER ENTRIES (what goes in LEDGERENTRIES.LIST):');
for (const le of tv.allLedgerEntries) {
  console.log(`  ${le.ledgerName.padEnd(35)} amount=${le.amount}`);
}

console.log('\n📦 INVENTORY ENTRIES + RATEDETAILS:');
for (const ie of tv.allInventoryEntries) {
  console.log(`\n  Item: "${ie.stockItemName}"  amount=${ie.amount}  gstLedgerSource="${ie.gstLedgerSource||'(none)'}"`);
  console.log(`    rateDetails:`);
  for (const rd of (ie.rateDetails || [])) {
    const computedTax = +((ie.amount * rd.gstRate) / 100).toFixed(2);
    console.log(`      ${rd.gstRateDutyHead.padEnd(12)} rate=${rd.gstRate}%  → Tally computes: ${ie.amount} × ${rd.gstRate}% = ${computedTax}`);
  }
}

// ── The KEY check: what Tally will compute vs what we send in LEDGERENTRIES ──
console.log('\n🔍 TALLY RECOMPUTE CHECK:');
let tallyComputedCGST = 0, tallyComputedSGST = 0, tallyComputedIGST = 0;
for (const ie of tv.allInventoryEntries) {
  for (const rd of (ie.rateDetails || [])) {
    const t = +((ie.amount * rd.gstRate) / 100).toFixed(2);
    if (rd.gstRateDutyHead === 'CGST')          tallyComputedCGST = +(tallyComputedCGST + t).toFixed(2);
    else if (rd.gstRateDutyHead === 'SGST/UTGST') tallyComputedSGST = +(tallyComputedSGST + t).toFixed(2);
    else if (rd.gstRateDutyHead === 'IGST')      tallyComputedIGST = +(tallyComputedIGST + t).toFixed(2);
  }
}
console.log(`  Tally RECOMPUTES CGST = ${tallyComputedCGST}  |  We send in LEDGERENTRIES = ${tv._totalCGST}  |  MATCH: ${tallyComputedCGST === tv._totalCGST ? '✅ YES' : '❌ NO MISMATCH!'}`);
console.log(`  Tally RECOMPUTES SGST = ${tallyComputedSGST}  |  We send in LEDGERENTRIES = ${tv._totalSGST}  |  MATCH: ${tallyComputedSGST === tv._totalSGST ? '✅ YES' : '❌ NO MISMATCH!'}`);
console.log(`  Tally RECOMPUTES IGST = ${tallyComputedIGST}  |  We send in LEDGERENTRIES = ${tv._totalIGST}  |  MATCH: ${tallyComputedIGST === tv._totalIGST ? '✅ YES' : '❌ NO MISMATCH!'}`);

// ── Full XML ──────────────────────────────────────────────────────────────────
console.log('\n📤 FULL VOUCHER XML BEING SENT TO TALLY:');
console.log('─────────────────────────────────────────');
const xml = serializeTallyVoucher(tv, cfg || {}, 'Create', '');
console.log(xml);
console.log('─────────────────────────────────────────');

await mongoose.disconnect();
