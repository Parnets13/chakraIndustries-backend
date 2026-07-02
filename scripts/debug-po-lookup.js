/**
 * debug-po-lookup.js
 * Checks what Tally returns when we query for BuyersOrderNo on vouchers.
 * Run: node --experimental-vm-modules scripts/debug-po-lookup.js
 */

import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

dotenv.config();

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function run() {
  await connectDB();

  const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
  if (!cfg) { console.error('No TallyConfig found'); process.exit(1); }

  console.log('TallyConfig:', { companyName: cfg.companyName, tallyLocalUrl: cfg.tallyLocalUrl, useConnector: cfg.useConnector });

  const company = (cfg.companyName || '').trim().toUpperCase();
  const coTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';

  // ── Test 1: Fetch vouchers with BUYERSORDERNO ─────────────────────────────
  console.log('\n─── TEST 1: Fetch vouchers with BuyersOrderNo ───');
  const xml1 = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>ERPVoucherPOLookup</ID>
</HEADER>
<BODY>
  <DESC>
    <STATICVARIABLES>
      ${coTag}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="ERPVoucherPOLookup">
        <TYPE>Voucher</TYPE>
        <FETCH>GUID, VoucherNumber, VoucherTypeName, BuyersOrderNo, OrderNo, ReferenceNo</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC>
</BODY>
</ENVELOPE>`;

  try {
    const resp1 = await postXmlWithRetry(cfg, xml1, 60000);
    console.log('RAW RESPONSE (first 3000 chars):\n', resp1?.slice(0, 3000));

    // Count vouchers
    const voucherBlocks = [...(resp1?.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi) || [])];
    console.log(`\nTotal voucher blocks found: ${voucherBlocks.length}`);

    // Show first 5 vouchers with their fields
    let withPO = 0;
    let withVoucherNo = 0;
    for (let i = 0; i < Math.min(voucherBlocks.length, 5); i++) {
      const block = voucherBlocks[i][1];
      const guid = (block.match(/<GUID>(.*?)<\/GUID>/i)?.[1] || '').trim();
      const vNum = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1] || '').trim();
      const vType = (block.match(/<VOUCHERTYPENAME>(.*?)<\/VOUCHERTYPENAME>/i)?.[1] || '').trim();
      const buyersOrderNo = (block.match(/<BUYERSORDERNO>(.*?)<\/BUYERSORDERNO>/i)?.[1] || '').trim();
      const orderNo = (block.match(/<ORDERNO>(.*?)<\/ORDERNO>/i)?.[1] || '').trim();
      const refNo = (block.match(/<REFERENCENO>(.*?)<\/REFERENCENO>/i)?.[1] || '').trim();
      console.log(`  Voucher[${i}]: GUID=${guid.slice(0,20)}... type=${vType} num=${vNum} BUYERSORDERNO="${buyersOrderNo}" ORDERNO="${orderNo}" REFERENCENO="${refNo}"`);
      if (buyersOrderNo) withPO++;
      if (vNum) withVoucherNo++;
    }

    // Count all with PO
    for (const m of voucherBlocks) {
      const b = m[1];
      const po = (b.match(/<BUYERSORDERNO>(.*?)<\/BUYERSORDERNO>/i)?.[1] || '').trim();
      if (po) withPO++;
    }
    console.log(`\nSummary: ${withVoucherNo}/${voucherBlocks.length} have VoucherNumber, ${withPO} have BuyersOrderNo`);

  } catch (err) {
    console.error('Test 1 FAILED:', err.message);
  }

  // ── Test 2: Also try VoucherNumber-only lookup ────────────────────────────
  console.log('\n─── TEST 2: Check VoucherNumber field name in XML ───');
  const xml2 = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>ERPVoucherNumLookup</ID>
</HEADER>
<BODY>
  <DESC>
    <STATICVARIABLES>
      ${coTag}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="ERPVoucherNumLookup">
        <TYPE>Voucher</TYPE>
        <FETCH>GUID, VoucherNumber, VoucherTypeName</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC>
</BODY>
</ENVELOPE>`;

  try {
    const resp2 = await postXmlWithRetry(cfg, xml2, 60000);
    const v2 = [...(resp2?.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi) || [])];
    console.log(`Total vouchers: ${v2.length}`);
    // Show first 5 voucher XML blocks RAW to see actual tag names
    for (let i = 0; i < Math.min(v2.length, 3); i++) {
      console.log(`\nVoucher[${i}] RAW BLOCK:\n${v2[i][1].slice(0, 500)}`);
    }
  } catch (err) {
    console.error('Test 2 FAILED:', err.message);
  }

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
