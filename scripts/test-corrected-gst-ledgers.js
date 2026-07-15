import mongoose from 'mongoose';
import connectDB   from '../config/database.js';
import Invoice     from '../models/Invoice.js';
import ItemMaster  from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';

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

async function fetchTallyGstLedgerNames(cfg) {
  try {
    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag   = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
    
    const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>AllLedgers</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="AllLedgers">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent, TaxType</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
    
    const resp = await postXmlWithRetry(cfg, xml, 30000, 1);
    if (!resp) return null;

    const cgstNames = [], sgstNames = [], igstNames = [];
    for (const m of resp.matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
      const block    = m[1];
      const name     = (block.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
      const parent   = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim().toLowerCase();
      const taxType  = (block.match(/<TAXTYPE>(.*?)<\/TAXTYPE>/i)?.[1] || '').trim().toLowerCase();
      if (!name) continue;
      const nameLow = name.toLowerCase();
      const isDutiesParent = parent.includes('duties') || parent.includes('tax');
      const hasTaxType     = !!taxType;
      const hasGstName     = nameLow.includes('cgst') || nameLow.includes('sgst') || nameLow.includes('igst');
      if (!isDutiesParent && !hasTaxType && !hasGstName) continue;
      if (taxType === 'central tax'    || nameLow.includes('cgst')) cgstNames.push(name);
      if (taxType === 'state tax'      || nameLow.includes('sgst')) sgstNames.push(name);
      if (taxType === 'integrated tax' || nameLow.includes('igst')) igstNames.push(name);
    }
    log(`✅ Fetched GST ledgers: cgst=[${cgstNames.join(', ')}] sgst=[${sgstNames.join(', ')}] igst=[${igstNames.join(', ')}]`);
    return { cgstNames, sgstNames, igstNames };
  } catch (e) {
    log(`❌ Failed to fetch GST ledgers: ${e.message}`);
    return null;
  }
}

async function main() {
  await connectDB();
  log('✅ MongoDB connected\n');

  const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
  if (!cfg) {
    log('❌ No TallyConfig found');
    process.exit(1);
  }

  // ── Step 1: Fetch live GST ledger names from Tally ───────────────────────
  log('Step 1: Fetching live GST ledger names from Tally...');
  const tallyGstLedgers = await fetchTallyGstLedgerNames(cfg);
  if (!tallyGstLedgers) {
    log('❌ Could not fetch GST ledgers');
    process.exit(1);
  }

  // ── Step 2: Find a test invoice ──────────────────────────────────────────
  log('\nStep 2: Finding a test invoice...');
  const inv = await Invoice.findOne({
    status: { $nin: ['Cancelled'] },
    source: { $nin: ['Tally', 'tally'] },
    $or: [
      { tallySync: { $ne: true } },
      { tallySync: true, tallySyncAt: { $exists: false } }
    ]
  }).lean();

  if (!inv) {
    log('❌ No pending invoice found');
    process.exit(1);
  }

  log(`✅ Using invoice: ${inv.invoiceNo} (party: ${inv.partyName})`);
  log(`   grandTotal: ${inv.grandTotal}, cgst: ${inv.cgstTotal}, sgst: ${inv.sgstTotal}, igst: ${inv.igstTotal}`);

  // ── Step 3: Fetch ItemMaster data ────────────────────────────────────────
  log('\nStep 3: Fetching ItemMaster data...');
  const itemNames = [...new Set(
    (inv.items || []).map(i => (i.description || i.name || '').trim()).filter(Boolean)
  )];
  const masters = itemNames.length
    ? await ItemMaster.find({ name: { $in: itemNames } }, 'name hsn tallySalesLedger').lean()
    : [];
  const masterMap = new Map(masters.map(m => [m.name, m]));

  const enrichedItems = (inv.items || []).map(item => {
    const n  = (item.description || item.name || '').trim();
    const im = masterMap.get(n);
    return {
      ...item,
      hsn:              (item.hsn || '').trim()              || (im?.hsn              || '').trim(),
      tallySalesLedger: (item.tallySalesLedger || '').trim() || (im?.tallySalesLedger || '').trim(),
    };
  });

  // ── Step 4: Normalize to TallyVoucher ────────────────────────────────────
  log('\nStep 4: Normalizing to TallyVoucher with live GST ledgers...');
  let tv;
  try {
    tv = normalizeToTallyVoucher(
      { ...inv, items: enrichedItems },
      { periodEnd: null, salesVoucherTypeName: 'Sales', tallyGstLedgers }
    );
    log('✅ Normalization successful');
  } catch (err) {
    log(`❌ Normalization failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 5: Log the resolved ledger names ────────────────────────────────
  log('\nStep 5: Resolved ledger names in TallyVoucher:');
  for (const entry of tv.allLedgerEntries) {
    if (entry.ledgerName.toLowerCase().includes('cgst') ||
        entry.ledgerName.toLowerCase().includes('sgst') ||
        entry.ledgerName.toLowerCase().includes('igst')) {
      log(`  ${entry.ledgerName} => ${entry.amount}`);
    }
  }

  // ── Step 6: Serialize to XML ─────────────────────────────────────────────
  log('\nStep 6: Serializing to Tally XML...');
  const voucherXml = serializeTallyVoucher(tv, cfg, 'Create', '');
  
  // ── Step 7: Print the XML with GST ledger sections highlighted ───────────
  log('\n=== GENERATED VOUCHER XML ===\n');
  log(voucherXml);

  log('\n=== LEDGER ENTRIES (GST sections) ===\n');
  const lines = voucherXml.split('\n');
  let inLedgerEntry = false;
  let buffer = [];
  for (const line of lines) {
    if (line.includes('<ALLLEDGERENTRIES.LIST>') || line.includes('<LEDGERENTRIES.LIST>')) {
      inLedgerEntry = true;
      buffer = [];
    }
    if (inLedgerEntry) {
      buffer.push(line);
    }
    if ((line.includes('</ALLLEDGERENTRIES.LIST>') || line.includes('</LEDGERENTRIES.LIST>')) && inLedgerEntry) {
      inLedgerEntry = false;
      // Only print entries with CGST/SGST/IGST
      const entry = buffer.join('\n');
      if (entry.toLowerCase().includes('cgst') ||
          entry.toLowerCase().includes('sgst') ||
          entry.toLowerCase().includes('igst')) {
        log(entry);
      }
    }
  }

  log('\n✅ Test voucher generated successfully!');
  log('You can now manually import this XML into Tally to verify the ledger names are correct.');
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
