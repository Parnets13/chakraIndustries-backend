/**
 * set-tally-sales-ledgers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time script: sets ItemMaster.tallySalesLedger for products that are
 * missing a mapping. This is the root cause of the "Tax amount does not match"
 * error in Tally Tax Analysis — GSTLEDGERSOURCE must point to a real Tally
 * sales ledger, not a computed name that doesn't exist.
 *
 * HOW TO USE:
 *   1. Update LEDGER_MAP below with your actual Tally ledger names
 *      (Gateway → Accounts Info → Ledgers → Display, filter by Sales Accounts group)
 *   2. Run:  node scripts/set-tally-sales-ledgers.js
 *   3. Then re-export invoices from ERP → Tally. Tax Analysis should now show
 *      "As per Transaction" matching "As per Calculation".
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import ItemMaster from '../models/ItemMaster.js';

// ─── MAP: item name substring (lowercase) → exact Tally ledger name ──────────
// Key = any substring of the item name (case-insensitive match)
// Value = EXACT ledger name as it exists in Tally (copy-paste from Tally UI)
//
// Order matters — first match wins. Put more specific patterns first.
const LEDGER_MAP = [
  // ── Steel / SS Bottles ──────────────────────────────────────────────────────
  { match: 'hydra steel water bottle',  ledger: 'SS Bottle Sales Local 5%' },
  { match: 'steel bottle',              ledger: 'SS Bottle Sales Local 5%' },
  { match: 'ss bottle',                 ledger: 'SS Bottle Sales Local 5%' },
  { match: 'water bottle',              ledger: 'SS Bottle Sales Local 5%' },

  // ── Add more mappings here as needed ────────────────────────────────────────
  // { match: 'comforter',             ledger: 'Comforter Sales Local @ 5%' },
  // { match: 'air cooler',            ledger: 'Air Cooler Sales Local 18%' },
  // { match: 'air fryer',             ledger: 'Air Fryer Sales Local 18%' },
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✓ Connected to MongoDB\n');

  // Find all ItemMasters with missing or empty tallySalesLedger
  const items = await ItemMaster.find({
    $or: [
      { tallySalesLedger: { $exists: false } },
      { tallySalesLedger: '' },
      { tallySalesLedger: null },
    ]
  }).lean();

  console.log(`Found ${items.length} item(s) with no tallySalesLedger set.\n`);

  let updated = 0;
  let unmatched = 0;

  for (const item of items) {
    const nameLow = (item.name || '').toLowerCase();
    const mapping = LEDGER_MAP.find(m => nameLow.includes(m.match.toLowerCase()));

    if (mapping) {
      await ItemMaster.updateOne(
        { _id: item._id },
        { $set: { tallySalesLedger: mapping.ledger } }
      );
      console.log(`  ✓ "${item.name}" → "${mapping.ledger}"`);
      updated++;
    } else {
      console.log(`  ⚠ "${item.name}" — NO MATCH FOUND — add to LEDGER_MAP manually`);
      unmatched++;
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Unmatched (needs manual mapping): ${unmatched}`);
  console.log(`\nNext step: re-export affected invoices from ERP → Tally.`);
  console.log(`In Tally Tax Analysis (Alt+A), "As per Transaction" should now match "As per Calculation".`);

  await mongoose.disconnect();
}

main().catch(console.error);
