import mongoose from 'mongoose';
import fs        from 'fs';
import path      from 'path';
import connectDB   from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

// ── Logger ─────────────────────────────────────────────────────────────────
function log(...args) {
  const line = args.join(' ');
  console.log(line);
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function main() {
  await connectDB();
  log('✅ MongoDB connected\n');

  const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
  if (!cfg) {
    log('❌ No TallyConfig found');
    process.exit(1);
  }

  const company = (cfg.companyName || '').trim().toUpperCase();
  const coTag   = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';

  log(`Company: ${company}`);
  log(`tallyLocalUrl: ${cfg.tallyLocalUrl || '(none)'}`);
  log(`useConnector: ${cfg.useConnector}`);
  log(`connectorId: ${cfg.connectorId || '(none)'}\n`);

  // ── Query 1: Fetch ALL ledgers in Duties & Taxes group
  log('Querying Tally for ALL ledgers in Duties & Taxes group...\n');
  const allLedgersXml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>DutiesTaxesLedgers</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="DutiesTaxesLedgers">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent, TaxType</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

  let allResp;
  try {
    allResp = await postXmlWithRetry(cfg, allLedgersXml, 30000, 1);
  } catch (err) {
    log(`❌ Failed to fetch ledgers: ${err.message}`);
    process.exit(1);
  }

  if (!allResp) {
    log('❌ No response from Tally');
    process.exit(1);
  }

  // Parse all ledgers
  log('=== ALL LEDGERS IN TALLY ===\n');
  const allLedgers = [];
  for (const m of allResp.matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
    const block    = m[1];
    const name     = (block.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
    const parent   = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim();
    const taxType  = (block.match(/<TAXTYPE>(.*?)<\/TAXTYPE>/i)?.[1] || '').trim();
    if (name) {
      allLedgers.push({ name, parent, taxType });
      log(`  ${name}`);
      log(`    Parent: ${parent}`);
      log(`    TaxType: ${taxType || '(none)'}`);
      log('');
    }
  }

  // ── Filter and categorize ───────────────────────────────────────────────
  log('\n=== FILTERED: GST TAX LEDGERS ===\n');
  const cgstLedgers = [];
  const sgstLedgers = [];
  const igstLedgers = [];

  for (const ledger of allLedgers) {
    const nameLow = ledger.name.toLowerCase();
    const taxTypeLow = (ledger.taxType || '').toLowerCase();
    const parentLow = ledger.parent.toLowerCase();

    const isDutiesParent = parentLow.includes('duties') || parentLow.includes('tax');
    const hasTaxType = !!ledger.taxType;
    const hasGstName = nameLow.includes('cgst') || nameLow.includes('sgst') || nameLow.includes('igst');

    // Include if: parent is Duties & Taxes, OR TaxType is set, OR name contains gst keyword.
    if (!isDutiesParent && !hasTaxType && !hasGstName) continue;

    if (taxTypeLow === 'central tax' || nameLow.includes('cgst')) {
      cgstLedgers.push(ledger.name);
      log(`[CGST] ${ledger.name} (TaxType: ${ledger.taxType})`);
    }
    if (taxTypeLow === 'state tax' || nameLow.includes('sgst')) {
      sgstLedgers.push(ledger.name);
      log(`[SGST] ${ledger.name} (TaxType: ${ledger.taxType})`);
    }
    if (taxTypeLow === 'integrated tax' || nameLow.includes('igst')) {
      igstLedgers.push(ledger.name);
      log(`[IGST] ${ledger.name} (TaxType: ${ledger.taxType})`);
    }
  }

  log('\n=== SUMMARY ===\n');
  log(`CGST Ledgers: ${cgstLedgers.join(', ') || '(none)'}`);
  log(`SGST Ledgers: ${sgstLedgers.join(', ') || '(none)'}`);
  log(`IGST Ledgers: ${igstLedgers.join(', ') || '(none)'}`);

  log('\n=== ACTUAL LEDGER NAMES TO USE IN XML ===\n');
  log(`For 2.5% GST tax entries:`);
  if (cgstLedgers.length > 0) log(`  CGST: "${cgstLedgers[0]}"`);
  if (sgstLedgers.length > 0) log(`  SGST: "${sgstLedgers[0]}"`);
  if (igstLedgers.length > 0) log(`  IGST: "${igstLedgers[0]}"`);

  // Write to file for easy reference
  const output = {
    company,
    timestamp: new Date().toISOString(),
    cgstLedgers,
    sgstLedgers,
    igstLedgers,
    recommended: {
      cgst: cgstLedgers[0] || 'CGST',
      sgst: sgstLedgers[0] || 'SGST',
      igst: igstLedgers[0] || 'IGST',
    },
  };

  const outFile = path.join(process.cwd(), 'logs', 'gst-ledger-names.json');
  fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8');
  log(`\n✅ Saved to: ${outFile}`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
