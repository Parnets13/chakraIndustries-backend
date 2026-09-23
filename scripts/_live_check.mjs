/**
 * _live_check.mjs — READ ONLY.
 * Fetches live Tally sales ledgers and checks whether the 13 ledger names
 * used by pending invoices exist EXACTLY in Tally. Shows close matches.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import TallyConfig from '../models/TallyConfig.js';

const WANT = [
  'Air Cooler Sales Local',
  'Air Fryer Sales Local',
  'Ceiling Fan Sales Local',
  'Coffee Maker Sales Local',
  'Dry Iron Sales Local',
  'Fan Heater Sales Local',
  'Hand Blenders and Chopper Sales Local',
  'Mixer Grinder Local Sales',
  'Neck Pillow Sales Local',
  'Toasters Sales Local',
  'Veg Chopper Sales Local',
  'Water Heater Sales Local',
  'Water Purifier Sales Local',
];

await mongoose.connect(process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');
const company = (cfg.companyName || '').trim().toUpperCase();
const coTag = company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';
const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AllLedgers</ID></HEADER>
<BODY><DESC><STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="AllLedgers"><TYPE>Ledger</TYPE><FETCH>Name,Parent</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

let resp;
try {
  resp = await postXmlWithRetry(cfg, xml, (cfg.useConnector && cfg.connectorId) ? 90000 : 30000, 3);
} catch (e) {
  console.log('TALLY NOT REACHABLE:', e.message);
  await mongoose.disconnect(); process.exit(1);
}

const all = [];
for (const m of String(resp || '').matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
  const name = (m[1].match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
  const parent = (m[1].match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim().toLowerCase();
  if (name && (parent.includes('sales') || name.toLowerCase().includes('sale'))) all.push(name);
}
console.log(`Live Tally sales ledgers: ${all.length}\n`);

for (const w of WANT) {
  const exact = all.find(l => l === w);
  if (exact) { console.log(`OK  "${w}"`); continue; }
  const ci = all.find(l => l.toLowerCase() === w.toLowerCase());
  if (ci) { console.log(`CASE-DIFF  want "${w}"  tally "${ci}"`); continue; }
  const wl = w.toLowerCase().split(/\s+/).filter(x => x.length > 2);
  const close = all.filter(l => { const ll = l.toLowerCase(); return wl.filter(x => ll.includes(x)).length >= 2; });
  console.log(`MISSING  "${w}"`);
  close.slice(0, 8).forEach(c => console.log(`     close -> "${c}"`));
}

console.log('\n===== ALL SALES LEDGERS IN TALLY =====');
all.sort().forEach(l => console.log('  ' + l));

await mongoose.disconnect();
process.exit(0);
