/**
 * list-remaining-blank.js — READ ONLY diagnostic.
 * Lists ItemMasters with blank HSN, dictionary coverage, categories, pending-invoice risk,
 * and writes HSN-Remaining-Blank-List.xlsx. Does NOT modify the database.
 *
 * Run: node list-remaining-blank.js
 */
import dotenv from 'dotenv';
dotenv.config();
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import ItemMaster from './models/ItemMaster.js';
import Invoice from './models/Invoice.js';
import { getHsnByName } from './services/hsnDictionary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'HSN-Remaining-Blank-List.xlsx');

// Category rules, checked in order (first match wins). Short tokens use word boundaries
// so 'ro' does not match "iron"/"control" and 'ss' does not match "glass".
const CATEGORIES = [
  ['SS items',        /\bss\b|steel|bottle|dabba|plate|kadai/i],
  ['Cooker items',    /cooker|pressure|gasket|weight/i],
  ['Fan items',       /\bfan|cooler|bldc/i],
  ['RO/Water items',  /\bro\b|purifier|waas|envy/i],
  ['Electrical',      /\biron\b|induction|mixer|bulb|kettle/i],
  ['Pillow/Bedsheet', /pillow|bedsheet|bed\s*sheet|comforter|towel/i],
];
const categorize = (name) => {
  for (const [label, re] of CATEGORIES) if (re.test(name)) return label;
  return 'Others';
};
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

async function run() {
  await connectDB();

  // 2. Counts
  const total = await ItemMaster.countDocuments();
  const withHsn = await ItemMaster.countDocuments({ hsn: { $exists: true, $nin: ['', null] } });
  const blankItems = await ItemMaster.find({
    $or: [{ hsn: { $exists: false } }, { hsn: '' }, { hsn: null }],
  }).select('name hsn updatedAt tallySalesLedger').sort({ updatedAt: -1 }).lean();

  console.log(`\nTotal ItemMaster : ${total}`);
  console.log(`With HSN         : ${withHsn}`);
  console.log(`Blank HSN        : ${blankItems.length}`);

  // 3. Dictionary coverage + 4. categories
  const enriched = blankItems.map((it) => {
    const name = (it.name || '').trim();
    const dictHsn = getHsnByName(name);
    return { name, dictHsn, canFix: !!dictHsn, category: categorize(name), updatedAt: it.updatedAt };
  });
  const auto = enriched.filter((e) => e.canFix);
  const manual = enriched.filter((e) => !e.canFix);

  console.log(`\nCan auto-fix via dictionary: ${auto.length}`);
  auto.slice(0, 20).forEach((e) => console.log(`  - ${e.name} -> ${e.dictHsn}`));
  console.log(`\nNeeds manual HSN: ${manual.length}`);
  manual.slice(0, 20).forEach((e) => console.log(`  - ${e.name}`));

  const catCounts = {};
  for (const e of enriched) catCounts[e.category] = (catCounts[e.category] || 0) + 1;
  console.log('\nCategory-wise count (blank items):');
  Object.entries(catCounts).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // 5. Pending invoices containing blank items
  const blankNames = new Set(enriched.map((e) => e.name));
  const pending = await Invoice.find({ tallySync: false })
    .select('invoiceNo items.description items.name').lean();
  const risky = new Map();
  for (const inv of pending) {
    for (const i of inv.items || []) {
      const n = (i.description || i.name || '').trim();
      if (n && blankNames.has(n)) {
        if (!risky.has(inv.invoiceNo)) risky.set(inv.invoiceNo, new Set());
        risky.get(inv.invoiceNo).add(n);
      }
    }
  }
  console.log(`\nPending invoices (tallySync:false): ${pending.length}`);
  console.log(`Pending invoices containing blank-HSN items: ${risky.size}`);
  [...risky.entries()].slice(0, 20).forEach(([no, s]) =>
    console.log(`  - ${no}: ${[...s].join(' | ')}`));

  // 6. Excel
  const catOrder = [...CATEGORIES.map((c) => c[0]), 'Others'];
  const sortFn = (a, b) =>
    (b.canFix - a.canFix) || (catOrder.indexOf(a.category) - catOrder.indexOf(b.category));
  const top200 = new Set(enriched.slice(0, 200));          // already newest-first
  const listed = enriched.filter((e) => e.canFix || top200.has(e)).sort(sortFn);

  const summary = [
    ['Metric', 'Value'],
    ['Total ItemMaster', total],
    ['With HSN', withHsn],
    ['Blank HSN', blankItems.length],
    ['Auto-fixable via dictionary', auto.length],
    ['Needs manual HSN', manual.length],
    ['Pending invoices containing blank-HSN items', risky.size],
    [],
    ['Category (blank items)', 'Count'],
    ...catOrder.map((c) => [c, catCounts[c] || 0]),
    [],
    ['Note', `Sheet 2 lists all auto-fixable items plus the 200 most recently updated blank items (${listed.length} rows).`],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  wsSummary['!cols'] = [{ wch: 45 }, { wch: 25 }];

  const rows = [
    ['Sr No', 'Item Name', 'Dictionary HSN (if any)', 'Can Auto-fix?', 'Category', 'Last Updated'],
    ...listed.map((e, i) => [i + 1, e.name, e.dictHsn, e.canFix ? 'YES' : 'NO', e.category, fmtDate(e.updatedAt)]),
  ];
  const wsItems = XLSX.utils.aoa_to_sheet(rows);
  wsItems['!cols'] = [{ wch: 7 }, { wch: 60 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
  XLSX.utils.book_append_sheet(wb, wsItems, 'Remaining Blank Items');
  XLSX.writeFile(wb, OUT);

  console.log(`\nExcel saved: ${OUT}`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('list-remaining-blank failed:', err.message);
  process.exit(1);
});
