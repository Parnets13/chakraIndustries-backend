/**
 * check-hsn-status.js — READ ONLY diagnostic.
 *
 * Reports the HSN fill rate across ItemMaster, which pending invoices are blocked
 * by a missing HSN, and which blocking items the hsnDictionary does NOT cover.
 *
 * Mirrors the export's real block rule (validateItemHsnAndType in
 * tallyExportService.js): an item blocks an invoice only when its HSN is blank in
 * ALL THREE sources — Invoice.items[].hsn, ItemMaster.hsn, and the getHsnByName()
 * dictionary fallback.
 *
 * Uses the app's connectDB() helper so the mongodb+srv SRV record resolves even on
 * networks with bad DNS (raw URI connects fail with "querySrv ECONNREFUSED").
 *
 * Run:  node check-hsn-status.js
 * DOES NOT MODIFY ANY DATA.
 */
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import ItemMaster from './models/ItemMaster.js';
import Invoice from './models/Invoice.js';
import { getHsnByName } from './services/hsnDictionary.js';

// The keyword list hard-coded in services/hsnDictionary.js (getHsnByName).
// Kept here only for the "coverage" report — the actual fallback below always
// calls the real getHsnByName() so results stay accurate even if this list drifts.
const DICTIONARY_KEYWORDS = [
  'induction', 'gas stove', 'gas chulha', 'pressure cooker', 'ro', 'water purifier',
  'envy', 'waas', 'air cooler', 'cooler', 'iron', 'immersion', 'rod', 'mixer',
  'grinder', 'aeon', 'bldc', 'fan', 'orient', 'pedestal', 'stand 32', 'plastic',
  'bottle', 'dabba', 'ss', 'dura', 'kent', 'gasket', 'rubber', 'weight', 'whistle',
  'seeti',
];

const hasHsn = (v) => !!(v && String(v).trim());

async function tryFetchApiReport() {
  // Optional: call the running server's /api/tally/hsn-full-report if reachable.
  const base = process.env.SELF_URL || `http://localhost:${process.env.PORT || 5000}`;
  const url = `${base}/api/tally/hsn-full-report`;
  try {
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) return { ok: false, note: `HTTP ${resp.status}` };
    return { ok: true, data: await resp.json() };
  } catch (e) {
    return { ok: false, note: e.message };
  }
}

async function run() {
  await connectDB();

  // ── 1. ItemMaster HSN fill rate ──────────────────────────────────────────
  const total = await ItemMaster.countDocuments({});
  const withHsn = await ItemMaster.countDocuments({
    hsn: { $exists: true, $nin: ['', null] },
  });
  const blankCount = total - withHsn;
  const blankItems = await ItemMaster.find({
    $or: [{ hsn: { $exists: false } }, { hsn: '' }, { hsn: null }],
  })
    .select('name hsn tallySalesLedger updatedAt')
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();
  const fillPct = total > 0 ? ((withHsn / total) * 100).toFixed(1) : '0.0';

  // ── 2 & 3. Pending invoices blocked by missing HSN ───────────────────────
  const pending = await Invoice.find({
    tallySync: false,
    status: { $ne: 'Cancelled' },
    source: { $nin: ['Tally', 'tally'] },
  })
    .select('invoiceNo items')
    .sort({ invoiceNo: 1 })
    .lean();

  // Pre-load ItemMaster HSN for every item name referenced by pending invoices.
  const pendingItemNames = [...new Set(
    pending.flatMap(inv => (inv.items || []).map(i => (i.description || i.name || '').trim())).filter(Boolean)
  )];
  const masters = pendingItemNames.length
    ? await ItemMaster.find({ name: { $in: pendingItemNames } }).select('name hsn').lean()
    : [];
  const masterHsn = new Map(masters.map(m => [m.name, (m.hsn || '').trim()]));

  // blockingItem name → Set(invoiceNo)
  const blockedByItem = new Map();
  const blockedInvoiceSet = new Set();

  for (const inv of pending) {
    for (const item of (inv.items || [])) {
      const name = (item.description || item.name || '').trim();
      if (!name) continue;
      const invoiceHsn = (item.hsn || '').trim();
      const imHsn      = masterHsn.get(name) || '';
      const dictHsn    = getHsnByName(name) || '';
      const blocked = !hasHsn(invoiceHsn) && !hasHsn(imHsn) && !hasHsn(dictHsn);
      if (blocked) {
        if (!blockedByItem.has(name)) blockedByItem.set(name, new Set());
        blockedByItem.get(name).add(inv.invoiceNo);
        blockedInvoiceSet.add(inv.invoiceNo);
      }
    }
  }

  // ── 4. Dictionary coverage for blocking items ────────────────────────────
  const uncoveredBlockingItems = [...blockedByItem.keys()].filter(
    name => !getHsnByName(name) // getHsnByName returns '' → not covered
  );

  // ── 5. Optional API report ───────────────────────────────────────────────
  const api = await tryFetchApiReport();

  // ── PRINT REPORT ─────────────────────────────────────────────────────────
  const line = '='.repeat(60);
  console.log(`\n${line}\n           HSN STATUS REPORT\n${line}\n`);

  console.log(`ItemMaster Total : ${total}`);
  console.log(`With HSN         : ${withHsn} (${fillPct}%)`);
  console.log(`Blank HSN        : ${blankCount}`);
  console.log(`\nBlank-HSN items (up to 50, newest first):`);
  if (!blankItems.length) {
    console.log('  (none — every ItemMaster has an HSN)');
  } else {
    blankItems.forEach(it => {
      const when = it.updatedAt ? new Date(it.updatedAt).toISOString().slice(0, 10) : '-';
      console.log(`  - ${it.name}  [updated ${when}]  ledger="${it.tallySalesLedger || ''}"`);
    });
    if (blankCount > blankItems.length) {
      console.log(`  ... and ${blankCount - blankItems.length} more`);
    }
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`Pending Invoices       : ${pending.length}`);
  console.log(`Blocked due to HSN     : ${blockedInvoiceSet.size}`);
  console.log(`\nBlocked items (item → invoice count + list):`);
  if (!blockedByItem.size) {
    console.log('  (none — no pending invoice is blocked by missing HSN)');
  } else {
    // Sort by most invoices blocked first.
    const sorted = [...blockedByItem.entries()].sort((a, b) => b[1].size - a[1].size);
    for (const [name, set] of sorted) {
      const list = [...set].sort();
      const preview = list.length > 6 ? `${list[0]}...${list[list.length - 1]}` : list.join(', ');
      console.log(`  - ${name}: ${set.size} invoice(s)  (${preview})`);
    }
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`hsnDictionary Coverage:`);
  console.log(`  Keywords present (${DICTIONARY_KEYWORDS.length}): ${DICTIONARY_KEYWORDS.join(', ')}`);
  console.log(`  Missing coverage for blocked items:`);
  if (!uncoveredBlockingItems.length) {
    console.log('    (none — or no blocked items)');
  } else {
    uncoveredBlockingItems.forEach(n => console.log(`    - ${n}  → getHsnByName() returns '' (add a keyword or set ItemMaster.hsn)`));
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`GET /api/tally/hsn-full-report:`);
  if (api.ok) {
    console.log(JSON.stringify(api.data, null, 2));
  } else {
    console.log(`  (not fetched — server not reachable: ${api.note}. Start the server and re-run, or hit the endpoint in a browser.)`);
  }

  console.log(`\n${line}\n`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('check-hsn-status failed:', err.message);
  process.exit(1);
});
