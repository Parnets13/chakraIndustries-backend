/**
 * Fetches the full XML of "Output CGST @ 2.5%" from Tally
 * so we can see exactly what field stores the rate.
 * Run AFTER manually setting the rate to 2.5% in Tally.
 *
 * node scripts/fetch-cgst-ledger-xml.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
const cfg = await TallyConfig.findOne({}).lean();
await mongoose.disconnect();

const co = (cfg.companyName || '').trim().toUpperCase();
const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';

// Fetch the full ledger master XML for Output CGST @ 2.5%
const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Object</TYPE>
  <SUBTYPE>Ledger</SUBTYPE>
  <ID>Output CGST @ 2.5%</ID>
</HEADER>
<BODY>
  <DESC>
    <STATICVARIABLES>
      ${coTag}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
  </DESC>
</BODY>
</ENVELOPE>`;

console.log('Fetching "Output CGST @ 2.5%" ledger from Tally...\n');

try {
  const resp = await postXmlWithRetry(cfg, xml, 30000, 1);
  console.log('=== FULL RESPONSE ===');
  console.log(resp);
  console.log('\n=== FIELDS WITH VALUES (non-empty, non-zero) ===');
  const matches = [...resp.matchAll(/<([A-Z][A-Z0-9.]+)>([^<]{1,50})<\/\1>/g)];
  for (const m of matches) {
    const val = m[2].trim();
    if (val && val !== '0' && val !== 'No' && val !== '' && !val.startsWith(' ')) {
      console.log(`  <${m[1]}>${val}</${m[1]}>`);
    }
  }
} catch (e) {
  console.error('Error:', e.message);
}

process.exit(0);
