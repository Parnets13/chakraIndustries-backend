/**
 * check-godowns.js
 * Run: node scripts/check-godowns.js
 * Shows all Warehouse records in MongoDB (these become GODOWNNAME in Tally XML)
 * and fetches actual godown names from the live Tally company for comparison.
 */
import mongoose   from 'mongoose';
import dotenv     from 'dotenv';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import TallyConfig from '../models/TallyConfig.js';
dotenv.config();

const WarehouseSchema = new mongoose.Schema({}, { strict: false });
const Warehouse = mongoose.model('Warehouse', WarehouseSchema, 'warehouses');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  // ── 1. Show all Warehouse records ─────────────────────────────────────────
  const warehouses = await Warehouse.find({}).lean();
  console.log('=== Warehouses in MongoDB (these are used as GODOWNNAME) ===');
  if (!warehouses.length) {
    console.log('  (none — fallback will be "Main Location")');
  } else {
    warehouses.forEach((w, i) => {
      console.log(`  [${i}] name="${w.name}"  status="${w.status || '?'}"  location="${w.location || ''}"`);
    });
  }

  const activeNames = warehouses.filter(w => w.status === 'Active').map(w => w.name);
  console.log(`\n  Active warehouse names: [${activeNames.join(', ') || '(none)'}]`);
  console.log(`  → resolvedGodown will be: "${activeNames[0] || 'Main Location'}"`);

  // ── 2. Fetch actual godown list from Tally ────────────────────────────────
  try {
    const cfg = await TallyConfig.findOne({}).lean();
    if (!cfg) { console.log('\nNo TallyConfig found — skipping live Tally check'); return; }

    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag   = company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';

    const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>ERPGodownCheck</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="ERPGodownCheck">
      <TYPE>Godown</TYPE><FETCH>Name, Parent</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

    console.log(`\n=== Tally godowns (company: ${company || '(not set)'}) ===`);
    const resp = await postXmlWithRetry(cfg, xml, 20000, 1);
    const godowns = [];
    for (const m of resp.matchAll(/<GODOWN[^>]*>([\s\S]*?)<\/GODOWN>/gi)) {
      const name   = (m[1].match(/<NAME>(.*?)<\/NAME>/i)?.[1]     || '').trim();
      const parent = (m[1].match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim();
      if (name) godowns.push({ name, parent });
    }
    if (!godowns.length) {
      console.log('  (none returned — Tally may not be running or company not open)');
    } else {
      godowns.forEach((g, i) => console.log(`  [${i}] "${g.name}"${g.parent ? '  parent="' + g.parent + '"' : ''}`));
    }

    // ── 3. Show the mismatch ───────────────────────────────────────────────
    console.log('\n=== Mismatch check ===');
    const tallyNames = godowns.map(g => g.name.toLowerCase());
    for (const wName of activeNames) {
      const match = godowns.find(g => g.name.trim().toLowerCase() === wName.trim().toLowerCase());
      if (match) {
        console.log(`  ✓ "${wName}" EXISTS in Tally — safe to use`);
      } else {
        console.log(`  ✗ "${wName}" NOT found in Tally — will cause "Godown does not exist" error!`);
      }
    }
    if (activeNames.length === 0) {
      console.log('  No active warehouses → will use "Main Location" fallback');
      const mainExists = tallyNames.includes('main location');
      console.log(`  "Main Location" in Tally: ${mainExists ? '✓ YES' : '✗ NO — this will also fail!'}`);
    }
  } catch (e) {
    console.log(`\nCould not reach Tally: ${e.message}`);
  }

  await mongoose.disconnect();
}

main().catch(console.error);
