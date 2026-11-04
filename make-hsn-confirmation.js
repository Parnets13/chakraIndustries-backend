/**
 * make-hsn-confirmation.js — READ ONLY. Generates HSN-Confirmation-List.xlsx
 * for the client to fill in confirmed HSN codes.
 *
 * Two sheets:
 *   "Summary"          — counts + urgent items
 *   "HSN Confirmation" — up to 100 items, urgent blockers first
 *
 * Uses connectDB() (config/database.js) for the DNS-safe SRV connection, and the
 * real getHsnByName() from services/hsnDictionary.js for suggested codes.
 *
 * Run:  node make-hsn-confirmation.js
 * DOES NOT MODIFY THE DATABASE.
 */
import dotenv from 'dotenv';
dotenv.config();
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import connectDB from './config/database.js';
import ItemMaster from './models/ItemMaster.js';
import Invoice from './models/Invoice.js';
import { getHsnByName } from './services/hsnDictionary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_ROWS = 100;

const hasHsn = (v) => !!(v && String(v).trim());

// Manual suggestions for categories the dictionary doesn't cover.
function suggestHsn(name) {
  const dict = getHsnByName(name);
  if (dict) return dict;
  const n = (name || '').toLowerCase();
  if (n.includes('kettle')) return '85167920';
  if (n.includes('pillow')) return '63079090';
  return '';
}

async function run() {
  await connectDB();

  // ── 1. All blank-HSN ItemMaster names, newest first ──────────────────────
  const blankItems = await ItemMaster.find({
    $or: [{ hsn: { $exists: false } }, { hsn: '' }, { hsn: null }],
  })
    .select('name hsn updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  // ── 2. Blocking items from pending invoices (real export block rule) ─────
  // Mirror the export's pending set. NOTE: do NOT add a source filter here — some
  // blocked invoices (e.g. BIW2941-2958) have a source value that a $nin filter was
  // excluding, which hid them from the blocked-item report. tallySync + status is
  // the correct, proven filter.
  const pending = await Invoice.find({
    tallySync: false,
    status: { $ne: 'Cancelled' },
  }).select('invoiceNo items').sort({ invoiceNo: 1 }).lean();

  const pendingNames = [...new Set(
    pending.flatMap(inv => (inv.items || []).map(i => (i.description || i.name || '').trim())).filter(Boolean)
  )];
  const imHsnDocs = pendingNames.length
    ? await ItemMaster.find({ name: { $in: pendingNames } }).select('name hsn').lean()
    : [];
  const imHsn = new Map(imHsnDocs.map(m => [m.name, (m.hsn || '').trim()]));

  const blockedByItem = new Map(); // name → Set(invoiceNo)
  for (const inv of pending) {
    for (const item of (inv.items || [])) {
      const name = (item.description || item.name || '').trim();
      if (!name) continue;
      const blocked = !hasHsn(item.hsn) && !hasHsn(imHsn.get(name)) && !hasHsn(getHsnByName(name));
      if (blocked) {
        if (!blockedByItem.has(name)) blockedByItem.set(name, new Set());
        blockedByItem.get(name).add(inv.invoiceNo);
      }
    }
  }
  const rangeLabel = (set) => {
    const list = [...set].sort();
    return list.length > 1 ? `${list[0]}-${list[list.length - 1]}` : list[0];
  };

  // ── 3/4. Build ordered, de-duplicated row list ───────────────────────────
  const rows = [];
  const seen = new Set();
  const addRow = (name, currentHsn, remarks) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      'Sr No': rows.length + 1,
      'Item Name': name,
      'Current HSN': currentHsn || '',
      'Suggested HSN (from dictionary)': suggestHsn(name),
      'Client Confirmed HSN': '',
      'Remarks': remarks,
    });
  };

  // Priority 1: URGENT blockers, most-blocked first
  const urgentSorted = [...blockedByItem.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [name, set] of urgentSorted) {
    addRow(name, imHsn.get(name) || '', `URGENT - ${set.size} invoices blocked (${rangeLabel(set)})`);
  }
  const urgentCount = rows.length;

  // Priority 2: other kettle/pillow items (future blockers)
  for (const it of blankItems) {
    if (rows.length >= MAX_ROWS) break;
    const n = it.name.toLowerCase();
    if (n.includes('kettle') || n.includes('pillow')) {
      addRow(it.name, it.hsn || '', 'Future blocker (kettle/pillow — no dictionary HSN)');
    }
  }

  // Priority 3: fill the rest from most-recent blank-HSN items up to MAX_ROWS
  for (const it of blankItems) {
    if (rows.length >= MAX_ROWS) break;
    addRow(it.name, it.hsn || '', 'Future use');
  }

  // ── 5. Summary sheet data ────────────────────────────────────────────────
  const totalItems = await ItemMaster.countDocuments({});
  const withHsn = await ItemMaster.countDocuments({ hsn: { $exists: true, $nin: ['', null] } });
  const blankHsn = totalItems - withHsn;
  const blockedInvoiceCount = new Set([...blockedByItem.values()].flatMap(s => [...s])).size;

  const summaryRows = [
    { Metric: 'Total ItemMaster', Value: totalItems },
    { Metric: 'With HSN', Value: withHsn },
    { Metric: 'Blank HSN', Value: blankHsn },
    { Metric: 'Currently Blocked Invoices', Value: `${blockedInvoiceCount} (${blockedByItem.size} items)` },
    { Metric: 'Urgent items needing HSN', Value: urgentCount },
    { Metric: 'Items listed in this file', Value: rows.length },
    { Metric: 'Generated', Value: new Date().toISOString() },
    { Metric: '', Value: '' },
    { Metric: 'Instructions', Value: 'Fill the "Client Confirmed HSN" column for each item and return this file.' },
    { Metric: '', Value: 'Rows marked URGENT are blocking invoices RIGHT NOW — please confirm those first.' },
  ];

  // ── Build workbook ───────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 30 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  const confirmSheet = XLSX.utils.json_to_sheet(rows);
  confirmSheet['!cols'] = [
    { wch: 7 },   // Sr No
    { wch: 45 },  // Item Name
    { wch: 14 },  // Current HSN
    { wch: 30 },  // Suggested HSN
    { wch: 22 },  // Client Confirmed HSN
    { wch: 45 },  // Remarks
  ];
  XLSX.utils.book_append_sheet(wb, confirmSheet, 'HSN Confirmation');

  const outPath = path.join(__dirname, 'HSN-Confirmation-List.xlsx');
  XLSX.writeFile(wb, outPath);

  console.log('\n===== HSN CONFIRMATION FILE CREATED =====');
  console.log(`Rows written      : ${rows.length} (urgent: ${urgentCount})`);
  console.log(`Blocked invoices  : ${blockedInvoiceCount}`);
  urgentSorted.forEach(([name, set]) => console.log(`  URGENT  ${name} → ${set.size} (${rangeLabel(set)})`));
  console.log(`\nFile saved to: ${outPath}`);
  console.log('Send this file to the client to confirm the HSN codes.\n');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('make-hsn-confirmation failed:', err.message);
  process.exit(1);
});
