/**
 * investigate-biw01.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Run: node scripts/investigate-biw01.js [invoiceNo]
 *
 * Runs all three investigations in parallel:
 *  1. Check if BIW01 (or the given voucher number) already exists in Tally
 *  2. Show the consignee/ship-to data for that invoice from MongoDB
 *  3. Confirm the retry-fix is deployed by showing the code block
 */
import mongoose   from 'mongoose';
import dotenv     from 'dotenv';
import fs         from 'fs';
import path       from 'path';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import TallyConfig from '../models/TallyConfig.js';
dotenv.config();

const VOUCHER_NO  = process.argv[2] || 'BIW01';
const InvoiceSchema = new mongoose.Schema({}, { strict: false });
const Invoice = mongoose.models.Invoice || mongoose.model('Invoice', InvoiceSchema, 'invoices');

// ── esc helper ────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const cfg = await TallyConfig.findOne({}).lean();
  const company = (cfg?.companyName || '').trim().toUpperCase();
  const coTag   = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
  console.log(`\nInvestigating voucher: "${VOUCHER_NO}"   company: "${company}"\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // INVESTIGATION 1 — Does this voucher already exist in Tally?
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('═'.repeat(70));
  console.log('INVESTIGATION 1: Check if voucher exists in Tally');
  console.log('═'.repeat(70));
  try {
    const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>ERPVoucherExistCheck</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="ERPVoucherExistCheck">
      <TYPE>Voucher</TYPE>
      <FETCH>GUID, VoucherNumber, VoucherTypeName, Date, PartyLedgerName, MasterId</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

    const resp = await postXmlWithRetry(cfg, xml, 30000, 1);
    const matches = [];
    for (const m of (resp || '').matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)) {
      const block = m[1];
      const vno   = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1] || '').trim();
      if (vno.toUpperCase() !== VOUCHER_NO.toUpperCase()) continue;
      const guid  = (block.match(/<GUID>(.*?)<\/GUID>/i)?.[1] || '').trim();
      const vtype = (block.match(/<VOUCHERTYPENAME>(.*?)<\/VOUCHERTYPENAME>/i)?.[1] || '').trim();
      const date  = (block.match(/<DATE>(.*?)<\/DATE>/i)?.[1] || '').trim();
      const party = (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1] || '').trim();
      const mid   = (block.match(/<MASTERID>(.*?)<\/MASTERID>/i)?.[1] || '').trim();
      matches.push({ vno, guid, vtype, date, party, mid });
    }

    if (matches.length === 0) {
      console.log(`  ✓ Voucher "${VOUCHER_NO}" does NOT exist in Tally — duplicate conflict ruled out`);
      console.log('  → EXCEPTIONS=1 is a validation error, not a duplicate. See Investigation 2.\n');
    } else {
      console.log(`  ✗ Voucher "${VOUCHER_NO}" ALREADY EXISTS in Tally (${matches.length} match(es)):`);
      matches.forEach((v, i) => {
        console.log(`    [${i}] VoucherNo="${v.vno}"  Type="${v.vtype}"  Date="${v.date}"`);
        console.log(`         Party="${v.party}"`);
        console.log(`         GUID="${v.guid}"  MasterId="${v.mid}"`);
      });
      console.log('\n  → This is a DUPLICATE conflict. The export engine must send ACTION="Alter"');
      console.log('    with the GUID above, not ACTION="Create". This is the root cause of EXCEPTIONS=1.\n');
    }
  } catch (e) {
    console.log(`  ERROR querying Tally: ${e.message}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INVESTIGATION 2 — Consignee partial-fill check
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('═'.repeat(70));
  console.log('INVESTIGATION 2: Consignee/ship-to data in MongoDB for this invoice');
  console.log('═'.repeat(70));
  const inv = await Invoice.findOne({
    invoiceNo: { $regex: new RegExp('^' + VOUCHER_NO + '$', 'i') }
  }).lean();

  if (!inv) {
    console.log(`  Invoice "${VOUCHER_NO}" not found in MongoDB\n`);
  } else {
    console.log(`  Invoice   : ${inv.invoiceNo}  Party: ${inv.partyName}`);
    console.log(`  Source    : ${inv.source}  Status: ${inv.status}`);
    console.log(`  PO ref    : ${inv.buyersOrderNo || inv.purchaseOrderRef || '(none)'}`);
    console.log('');
    console.log('  ── Ship To (→ CONSIGNEE tags) ──────────────────────────────────');
    console.log(`    shipToName    : "${inv.shipToName || ''}"  → CONSIGNEEMAILINGNAME`);
    console.log(`    shipToState   : "${inv.shipToState || ''}"  → CONSIGNEESTATENAME / SHIPTOPLACE`);
    console.log(`    shipToGST     : "${inv.shipToGST || ''}"   → CONSIGNEEGSTIN`);
    console.log(`    shipToPincode : "${inv.shipToPincode || ''}"  → CONSIGNEEPINCODE`);
    console.log(`    shipToAddress : "${inv.shipToAddress || ''}"`);
    console.log('');

    const hasName    = !!(inv.shipToName || '').trim();
    const hasState   = !!(inv.shipToState || '').trim();
    const hasGSTIN   = !!(inv.shipToGST || '').trim();
    const hasPin     = !!(inv.shipToPincode || inv.partyPostal || '').trim();
    const partialFill = hasName && (!hasState || !hasGSTIN);
    const fullyEmpty  = !hasName && !hasState && !hasGSTIN;
    const fullyFilled = hasName && hasState; // minimum for valid consignee

    if (fullyEmpty) {
      console.log('  ✓ Consignee section is FULLY EMPTY — Tally won\'t add consignee tags');
      console.log('    This is valid. EXCEPTIONS=1 is from something else.\n');
    } else if (partialFill) {
      console.log('  ✗ PARTIAL CONSIGNEE DATA — this is likely causing the silent EXCEPTIONS=1!');
      console.log('    CONSIGNEEMAILINGNAME is set but CONSIGNEESTATENAME / CONSIGNEEGSTIN are empty.');
      console.log('    For a GST-enabled company, Tally requires Place of Supply when consignee is named.');
      console.log('    FIX: Either populate all consignee fields, or omit them all.\n');
    } else if (fullyFilled) {
      console.log('  ✓ Consignee data looks complete — not the cause of EXCEPTIONS=1\n');
    }

    console.log('  ── Items ───────────────────────────────────────────────────────');
    (inv.items || []).forEach((item, i) => {
      console.log(`    [${i}] "${item.description || item.name}"`);
      console.log(`         tallySalesLedger: "${item.tallySalesLedger || '(empty)'}"`);
      console.log(`         qty: ${item.qty}  rate: ${item.rate}  unit: ${item.unit || '?'}`);
      console.log(`         cgst: ${item.cgst || 0}  sgst: ${item.sgst || 0}  igst: ${item.igst || 0}`);
    });
    console.log('');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INVESTIGATION 3 — Verify retry-fix deployment
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('═'.repeat(70));
  console.log('INVESTIGATION 3: Verify retry-fix is deployed');
  console.log('═'.repeat(70));
  const svcPath = path.join(process.cwd(), 'services', 'tallyExportService.js');
  const svc = fs.readFileSync(svcPath, 'utf8');

  const hasMasterCheck = svc.includes('isMasterNotFoundError');
  const hasGuidCheck   = svc.includes('hasGuidInXml');
  const hasFailFast    = svc.includes('Master data error (nothing created in Tally');
  const hasOldBlindRetry = svc.includes("'EXCEPTIONS=1 on Create — voucher may exist with different structure'");

  console.log(`  isMasterNotFoundError check : ${hasMasterCheck ? '✓ PRESENT' : '✗ MISSING — old code still running!'}`);
  console.log(`  hasGuidInXml guard          : ${hasGuidCheck   ? '✓ PRESENT' : '✗ MISSING'}`);
  console.log(`  Fail-fast for master errors : ${hasFailFast    ? '✓ PRESENT' : '✗ MISSING'}`);
  console.log(`  Old blind retry (should be gone): ${hasOldBlindRetry ? '✗ STILL PRESENT — fix not deployed!' : '✓ REMOVED'}`);
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════
  // RECOMMENDATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('═'.repeat(70));
  console.log('RECOMMENDATION');
  console.log('═'.repeat(70));

  const hasConsigneeProblem = inv &&
    !!(inv.shipToName || '').trim() &&
    (!(inv.shipToState || '').trim() || !(inv.shipToGST || '').trim());

  if (hasConsigneeProblem) {
    console.log(`  PRIMARY CAUSE: Partial consignee data on invoice ${VOUCHER_NO}.`);
    console.log('  The CONSIGNEEMAILINGNAME tag is set but CONSIGNEESTATENAME is empty.');
    console.log('  Tally Prime silently rejects the voucher because it cannot resolve');
    console.log('  Place of Supply without a consignee state for GST calculation.');
    console.log('');
    console.log('  Fix options:');
    console.log('  A) If you have the ship-to state for SANGAMKUMAR: populate shipToState');
    console.log('     and shipToPincode in the Invoice record, then re-export.');
    console.log('  B) If ship-to details are not available: clear shipToName so the');
    console.log('     normalizer omits all consignee tags entirely from the XML.');
    console.log('     Run: db.invoices.updateOne({invoiceNo:"BIW01"},{$set:{shipToName:"",shipToAddress:""}})');
  } else {
    console.log(`  See investigation 1 results above for the primary cause.`);
  }

  await mongoose.disconnect();
}

main().catch(console.error);
