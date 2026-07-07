/**
 * verify-and-migrate-gst.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Run this on the Render server (or any machine that can reach Atlas).
 *
 * What it does:
 *   1. DIAGNOSE  — inspect 5 recent invoices: show raw item fields, stored
 *                  tallyVoucher inventory entries, ItemMaster records, and
 *                  whether tallySalesLedger is populated per item.
 *   2. MIGRATE   — load all ItemMaster records, enrich invoice items with
 *                  tallySalesLedger + hsn, then re-normalize ALL invoices
 *   3. VERIFY    — re-read the first invoice and print the generated XML
 *                  for the first inventory entry so you can confirm
 *                  GSTLEDGERSOURCE / HSNLEDGERSOURCE / GSTHSNNAME are set
 *
 * Usage (on Render shell or any server with MONGO_URI in env):
 *   node scripts/verify-and-migrate-gst.js
 */

import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import Invoice     from '../models/Invoice.js';
import ItemMaster  from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function renderInventoryEntry(item) {
  const absAmount = Math.abs(item.amount || 0);
  const gstSrc    = (item.gstLedgerSource  || item.accountingAllocations?.[0]?.ledgerName || '').trim();
  const hsnSrc    = (item.hsnLedgerSource  || gstSrc).trim();
  const hsnName   = (item.gstHsnName       || '').trim();
  const acctXml   = (item.accountingAllocations || []).map(aa => `
      <ACCOUNTINGALLOCATIONS.LIST>
        <LEDGERNAME>${esc(aa.ledgerName)}</LEDGERNAME>
        <AMOUNT>${Math.abs(aa.amount || 0).toFixed(2)}</AMOUNT>
      </ACCOUNTINGALLOCATIONS.LIST>`).join('');

  return `  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(item.stockItemName)}</STOCKITEMNAME>
    <RATE>${esc(item.rate)}</RATE>
    <AMOUNT>${absAmount.toFixed(2)}</AMOUNT>
    <ACTUALQTY>${esc(item.actualQty)}</ACTUALQTY>
    <BILLEDQTY>${esc(item.billedQty)}</BILLEDQTY>
    ${gstSrc
      ? `<GSTSOURCETYPE>${esc(item.gstSourceType || 'Ledger')}</GSTSOURCETYPE>\n    <GSTLEDGERSOURCE>${esc(gstSrc)}</GSTLEDGERSOURCE>`
      : '<!-- GSTLEDGERSOURCE MISSING -->'}
    ${hsnSrc
      ? `<HSNSOURCETYPE>${esc(item.hsnSourceType || 'Ledger')}</HSNSOURCETYPE>\n    <HSNLEDGERSOURCE>${esc(hsnSrc)}</HSNLEDGERSOURCE>`
      : '<!-- HSNLEDGERSOURCE MISSING -->'}
    <GSTOVRDNTAXABILITY>${esc(item.gstOverrideTaxability || 'Taxable')}</GSTOVRDNTAXABILITY>
    <GSTOVRDNTYPEOFSUPPLY>${esc(item.gstOverrideSupplyType || 'Goods')}</GSTOVRDNTYPEOFSUPPLY>
    ${hsnName ? `<GSTHSNNAME>${esc(hsnName)}</GSTHSNNAME>` : '<!-- GSTHSNNAME: no HSN set for this item -->'}${acctXml}
  </ALLINVENTORYENTRIES.LIST>`;
}

const HR = '═'.repeat(80);

async function run() {
  console.log(`${HR}\nverify-and-migrate-gst.js  ${new Date().toISOString()}\n${HR}\n`);
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('✅ MongoDB connected\n');

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1: DIAGNOSE
  // ──────────────────────────────────────────────────────────────────────────
  console.log('STEP 1: DIAGNOSE (before migration)\n' + '─'.repeat(60));

  const invoices = await Invoice.find(
    { 'items.0': { $exists: true }, grandTotal: { $gt: 0 } },
    'invoiceNo partyName grandTotal cgstTotal sgstTotal igstTotal items tallyVoucher'
  ).sort({ createdAt: -1 }).limit(5).lean();

  if (!invoices.length) {
    console.log('❌ No invoices found'); await mongoose.disconnect(); return;
  }

  for (const inv of invoices) {
    console.log(`\n  INVOICE ${inv.invoiceNo}  party="${inv.partyName}"  total=${inv.grandTotal}`);
    for (const item of (inv.items || []).slice(0, 3)) {
      console.log(`    raw item: name="${item.description||item.name}"  hsn="${item.hsn||''}"  tallySalesLedger="${item.tallySalesLedger||'(not set in item)'}"`);
    }
    const tv = inv.tallyVoucher;
    if (tv) {
      for (const ie of (tv.allInventoryEntries || []).slice(0, 3)) {
        console.log(`    stored IE "${ie.stockItemName}":`);
        console.log(`      acctAlloc[0]   : "${ie.accountingAllocations?.[0]?.ledgerName || '(none)'}"`);
        console.log(`      gstLedgerSource: "${ie.gstLedgerSource || '** MISSING **'}"`);
        console.log(`      hsnLedgerSource: "${ie.hsnLedgerSource || '** MISSING **'}"`);
        console.log(`      gstHsnName     : "${ie.gstHsnName      || '** MISSING **'}"`);
      }
    } else {
      console.log('    tallyVoucher: NULL');
    }
  }

  // ItemMaster check
  const firstInv  = invoices[0];
  const itemNames = (firstInv.items || []).map(i => (i.description || i.name || '').trim()).filter(Boolean);
  const itemMasters = await ItemMaster.find({ name: { $in: itemNames } }, 'name hsn tallySalesLedger gst').lean();

  console.log(`\n  ItemMaster for "${firstInv.invoiceNo}" items:`);
  if (!itemMasters.length) {
    console.log('    ❌ None found — item names may not match ItemMaster.name');
    console.log(`    Looked up: [${itemNames.slice(0,5).join(', ')}]`);
  } else {
    for (const im of itemMasters) {
      console.log(`    "${im.name}"  hsn="${im.hsn||''}"  gst=${im.gst}  tallySalesLedger="${im.tallySalesLedger||'(not set)'}"`);
    }
  }

  const totalIM = await ItemMaster.countDocuments({});
  const withLed = await ItemMaster.countDocuments({ tallySalesLedger: { $exists: true, $ne: '' } });
  console.log(`\n  ItemMaster: ${totalIM} total, ${withLed} have tallySalesLedger`);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2: MIGRATE
  // ──────────────────────────────────────────────────────────────────────────
  console.log(`\n${HR}\nSTEP 2: MIGRATE\n` + '─'.repeat(60));

  const cfg = await TallyConfig.findOne({}, 'tallyPeriodEnd').lean();
  const periodEnd = cfg?.tallyPeriodEnd || null;
  console.log(`  periodEnd: ${periodEnd || '(none)'}`);

  // Load ALL ItemMaster records once
  const allMasters = await ItemMaster.find({}, 'name hsn tallySalesLedger').lean();
  const masterMap  = new Map(allMasters.map(m => [m.name, m]));
  console.log(`  Loaded ${masterMap.size} ItemMaster records into lookup map`);

  function enrichItems(items) {
    return (items || []).map(item => {
      const name = (item.description || item.name || '').trim();
      const im   = masterMap.get(name);
      return { ...item, hsn: item.hsn || im?.hsn || '', tallySalesLedger: item.tallySalesLedger || im?.tallySalesLedger || '' };
    });
  }

  let processed = 0, succeeded = 0, failed = 0, skipped = 0;
  const failures = [];
  const cursor = Invoice.find({ invoiceNo: { $exists: true, $ne: '' } }).select('-__v').lean().cursor();

  for await (const inv of cursor) {
    processed++;
    try {
      const grandTotal = +(inv.grandTotal || inv.totalAmount || 0);
      if (!inv.partyName || grandTotal <= 0) { skipped++; continue; }
      const enrichedItems = enrichItems(inv.items);
      const tv = normalizeToTallyVoucher({ ...inv, items: enrichedItems }, { periodEnd });
      await Invoice.updateOne({ _id: inv._id }, { $set: { tallyVoucher: tv } });
      succeeded++;
      if (succeeded % 50 === 0) console.log(`  ... ${succeeded} normalized`);
    } catch (err) {
      failed++;
      failures.push({ invoiceNo: inv.invoiceNo || String(inv._id), error: err.message });
      if (failed <= 10) console.error(`  FAILED ${inv.invoiceNo||inv._id}: ${err.message}`);
    }
  }
  console.log(`  processed=${processed} succeeded=${succeeded} skipped=${skipped} failed=${failed}`);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3: VERIFY
  // ──────────────────────────────────────────────────────────────────────────
  console.log(`\n${HR}\nSTEP 3: VERIFY (after migration)\n` + '─'.repeat(60));

  const freshInv = await Invoice.findById(firstInv._id).lean();
  const freshTV  = freshInv?.tallyVoucher;

  if (!freshTV) {
    console.log('  ❌ tallyVoucher still NULL — check failures above');
    await mongoose.disconnect(); return;
  }

  console.log(`\n  Invoice: ${freshInv.invoiceNo}`);
  console.log(`  allLedgerEntries: ${freshTV.allLedgerEntries?.map(e=>`${e.ledgerName}=${e.amount}`).join(' | ')}`);

  for (const ie of (freshTV.allInventoryEntries || []).slice(0, 5)) {
    console.log(`\n  IE "${ie.stockItemName}":`);
    console.log(`    acctAlloc[0]   : "${ie.accountingAllocations?.[0]?.ledgerName || '(none)'}"`);
    console.log(`    gstLedgerSource: "${ie.gstLedgerSource || '** STILL MISSING **'}"`);
    console.log(`    hsnLedgerSource: "${ie.hsnLedgerSource || '** STILL MISSING **'}"`);
    console.log(`    gstHsnName     : "${ie.gstHsnName      || '(empty — no HSN)'}"`);
  }

  if (freshTV.allInventoryEntries?.length) {
    console.log('\n  XML for first inventory entry:');
    console.log('  ' + '─'.repeat(70));
    console.log(renderInventoryEntry(freshTV.allInventoryEntries[0]));
    console.log('  ' + '─'.repeat(70));
  }

  // Final verdict
  const ie0 = freshTV.allInventoryEntries?.[0];
  console.log('\n  VERDICT:');
  if (!ie0) {
    console.log('  ⚠  No inventory entries (pure accounting voucher)');
  } else {
    const checks = [
      { label: 'GSTLEDGERSOURCE present',    pass: !!ie0.gstLedgerSource },
      { label: 'HSNLEDGERSOURCE present',    pass: !!ie0.hsnLedgerSource },
      { label: 'GSTOVRDNTAXABILITY present', pass: !!ie0.gstOverrideTaxability },
      { label: 'GSTOVRDNTYPEOFSUPPLY present',pass: !!ie0.gstOverrideSupplyType },
      { label: 'GSTHSNNAME present',          pass: !!ie0.gstHsnName },
      { label: 'GSTLEDGERSOURCE ≠ "Sales Accounts"', pass: ie0.gstLedgerSource !== 'Sales Accounts', warn: true },
    ];
    checks.forEach(c => {
      const icon = c.pass ? '  ✅' : (c.warn ? '  ⚠ ' : '  ❌');
      console.log(`${icon} ${c.label}: "${ie0[c.label.split(' ')[0].toLowerCase()] || ie0.gstLedgerSource || ''}"`);
    });

    if (ie0.gstLedgerSource === 'Sales Accounts') {
      console.log('\n  ⚠  gstLedgerSource is "Sales Accounts" (generic fallback).');
      console.log('  This means NO ItemMaster record has tallySalesLedger set.');
      console.log('  Tally will still accept this — "Sales Accounts" is valid.');
      console.log('  To get item-specific ledger names, populate ItemMaster.tallySalesLedger:');
      console.log('    • Via Tally sync (fetches real ledger names from your company)');
      console.log('    • Or update each ItemMaster record manually');
    }
  }

  console.log(`\n${HR}`);
  await mongoose.disconnect();
  console.log('Done. Now clear tallySync on invoices and re-export to Tally.');
  process.exit(0);
}

run().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
