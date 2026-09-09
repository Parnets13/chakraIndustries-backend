/**
 * READ-ONLY. Asks Tally for all Sales-group ledgers (and checks whether the
 * bad "AVR SWARNA..." ledger + a water-purifier item exist). Changes nothing.
 *
 * Requires: Tally open + connector online (same as check-tally-open.js).
 * Run: node scripts/_list-tally-sales-ledgers.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

await mongoose.connect(process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const company = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim();
console.log('Company:', company, '| connector:', cfg.useConnector, cfg.connectorId, '\n');

// ── 1. All ledgers with their parent group ──────────────────────────────────
const ledgerXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AllLedgers</ID></HEADER>
<BODY><DESC><STATICVARIABLES>
  <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
  <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
<TDL><TDLMESSAGE>
  <COLLECTION NAME="AllLedgers"><TYPE>Ledger</TYPE><FETCH>Name,Parent</FETCH></COLLECTION>
</TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

const resp = await postXmlWithRetry(cfg, ledgerXml, 60000);

const ledgers = [];
for (const m of (resp || '').matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
  const block = m[1];
  const name   = (block.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
  const parent = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim();
  if (name) ledgers.push({ name, parent });
}

console.log(`Total ledgers in Tally: ${ledgers.length}\n`);

const sales = ledgers.filter(l => /sales/i.test(l.parent) || /sales/i.test(l.name));
console.log('════════ SALES-RELATED LEDGERS IN TALLY ════════');
sales.sort((a,b)=>a.name.localeCompare(b.name)).forEach(l => console.log(`   "${l.name}"   [parent: ${l.parent}]`));
console.log(`(${sales.length} sales-related ledgers)\n`);

// Does the bad ledger exist as a ledger at all, and under which group?
const bad = ledgers.find(l => /AVR SWARNA MAHAL/i.test(l.name));
console.log('Bad ledger "AVR SWARNA MAHAL JEWELRY..." exists in Tally?',
  bad ? `YES — but under group "${bad.parent}" (NOT a sales ledger)` : 'NO — does not exist at all');

await mongoose.disconnect();
process.exit(0);
