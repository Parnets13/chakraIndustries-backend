// tally-diagnose.js — Sends ONE failing invoice's voucher XML to Tally ALONE,
// with SVSHOWERRORLIST=Yes, and prints Tally's COMPLETE raw response so we can
// read the exact rejection reason. Also sends the auto-masters for that item first.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import ItemMaster from './models/ItemMaster.js';
import TallyConfig from './models/TallyConfig.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from './services/tallyExportService.js';
import { postXmlWithRetry } from './services/tallyFetchEngine.js';

const esc = s => s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const no = process.argv[2] || 'BIW2560';

function envelope(co, inner) {
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES>${co?`<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>`:''}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${inner}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

async function main() {
  await connectDB();
  const cfg = await TallyConfig.findOne().lean();
  if (!cfg) { console.log('No TallyConfig'); process.exit(0); }
  console.log('Tally company:', cfg.companyName, '| connector:', cfg.useConnector, cfg.connectorId || '');

  const inv = await Invoice.findOne({ invoiceNo: no }).lean();
  if (!inv) { console.log('invoice not found:', no); process.exit(0); }

  const tv = normalizeToTallyVoucher(inv, {});
  const voucherXml = serializeTallyVoucher(tv, cfg, 'Create', '');
  const env = envelope((cfg.companyName||'').toUpperCase(), voucherXml);

  console.log(`\n=== Sending ${no} ALONE to Tally (SVSHOWERRORLIST=Yes) ===\n`);
  try {
    const resp = await postXmlWithRetry(cfg, env, (cfg.useConnector && cfg.connectorId) ? 120000 : 60000, 1);
    console.log('════════ TALLY RAW RESPONSE ════════');
    console.log(resp);
    console.log('════════════════════════════════════');
  } catch (e) {
    console.log('SEND ERROR:', e.message);
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
