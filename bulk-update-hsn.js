/**
 * bulk-update-hsn.js
 * 1) Reads client-confirmed HSN codes from HSN-Confirmation-List.xlsx
 * 2) Updates ItemMaster.hsn for each confirmed item
 * 3) Adds priority keywords to services/hsnDictionary.js (idempotent)
 * 4) Prints verification (ItemMaster HSN count, blocked invoices)
 *
 * Run: node bulk-update-hsn.js
 */
import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import ItemMaster from './models/ItemMaster.js';
import Invoice from './models/Invoice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hasHsn = (v) => !!(v && String(v).trim());

// ── STEP 3: dictionary update (file only) ───────────────────────────────────
function updateDictionary() {
  const file = path.join(__dirname, 'services', 'hsnDictionary.js');
  let src = fs.readFileSync(file, 'utf8');
  const marker = '// Client confirmed Dec 2025 - Kettle and Pillow fix';
  if (src.includes(marker)) {
    console.log('hsnDictionary.js already contains client-confirmed block, skipping.');
    return;
  }
  const anchor = "  const n = name.toLowerCase();\n";
  const idx = src.indexOf(anchor);
  if (idx === -1) throw new Error('Anchor not found in hsnDictionary.js');
  const block =
`
  ${marker}
  // (placed first for priority; replaces old kettle 85167920 / pillow 63079090 values)
  if (/\\bkettle\\b/i.test(n))                  return '85166000';
  if (/neck\\s*pillow|pillow/i.test(n))         return '94042190';
  if (/bedsheet|bed\\s*sheet/i.test(n))         return '63041910';
  if (/comforter/i.test(n))                    return '58110090';
`;
  src = src.slice(0, idx + anchor.length) + block + src.slice(idx + anchor.length);
  fs.writeFileSync(file, src, 'utf8');
  console.log('hsnDictionary.js updated.');
}

async function run() {
  // ── STEP 1: read Excel ────────────────────────────────────────────────────
  const wb = XLSX.readFile(path.join(__dirname, 'HSN-Confirmation-List.xlsx'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['HSN Confirmation']);
  const confirmed = rows.filter(r => String(r['Client Confirmed HSN'] ?? '').trim());
  console.log(`Confirmed rows: ${confirmed.length}`);

  await connectDB();
  const before = await ItemMaster.countDocuments({ hsn: { $exists: true, $nin: ['', null] } });

  // ── STEP 2: update ItemMaster ─────────────────────────────────────────────
  let ok = 0;
  const notFound = [];
  for (const r of confirmed) {
    const itemName = String(r['Item Name']).trim();
    const clientHsn = String(r['Client Confirmed HSN']).trim();
    const doc = await ItemMaster.findOneAndUpdate(
      { name: itemName },
      { $set: { hsn: clientHsn } },
      { upsert: false, new: true }
    );
    if (doc) {
      ok++;
      console.log(`Updated: ${itemName} -> ${clientHsn}`);
    } else {
      notFound.push(itemName);
      console.log(`NOT FOUND: ${itemName}`);
    }
  }
  console.log(`\nSuccess: ${ok}  Failed (not found): ${notFound.length}`);

  // ── STEP 3: dictionary ────────────────────────────────────────────────────
  updateDictionary();

  // ── STEP 4: verify (import dictionary fresh after edit) ───────────────────
  const { getHsnByName } = await import(`./services/hsnDictionary.js?v=${Date.now()}`);
  const after = await ItemMaster.countDocuments({ hsn: { $exists: true, $nin: ['', null] } });
  console.log(`\nItemMaster with HSN: ${before} -> ${after}`);

  const pending = await Invoice.find({
    tallySync: false,
    status: { $ne: 'Cancelled' },
    source: { $nin: ['Tally', 'tally'] },
  }).select('invoiceNo status items').lean();

  const names = [...new Set(pending.flatMap(inv => (inv.items || [])
    .map(i => (i.description || i.name || '').trim())).filter(Boolean))];
  const masters = names.length
    ? await ItemMaster.find({ name: { $in: names } }).select('name hsn').lean() : [];
  const masterHsn = new Map(masters.map(m => [m.name, (m.hsn || '').trim()]));

  const blocked = new Set();
  const blockedDraft = new Set();
  for (const inv of pending) {
    for (const item of inv.items || []) {
      const name = (item.description || item.name || '').trim();
      if (!name) continue;
      if (!hasHsn(item.hsn) && !hasHsn(masterHsn.get(name)) && !hasHsn(getHsnByName(name))) {
        blocked.add(inv.invoiceNo);
        if (inv.status === 'Draft') blockedDraft.add(inv.invoiceNo);
      }
    }
  }
  console.log(`Pending invoices: ${pending.length}`);
  console.log(`Blocked by blank HSN (all pending): ${blocked.size} ${[...blocked].join(', ')}`);
  console.log(`Blocked by blank HSN (Draft only):  ${blockedDraft.size}`);

  for (const n of ['Greenchef Ele Kettle 1.8ltr Glitter', 'Travel Neck Pillow']) {
    const m = await ItemMaster.findOne({ name: n }).select('hsn').lean();
    console.log(`Urgent item "${n}": ItemMaster.hsn=${m?.hsn || '(blank)'}  dictionary=${getHsnByName(n)}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('bulk-update-hsn failed:', err);
  process.exit(1);
});
