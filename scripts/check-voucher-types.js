#!/usr/bin/env node
/**
 * check-voucher-types.js
 * Queries Tally for the exact voucher type names configured in the open company.
 * Run this to find the correct VOUCHERTYPENAME to use for Sales invoices.
 *
 * Usage: node scripts/check-voucher-types.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected to MongoDB');

  const cfg = await TallyConfig.findOne().lean();
  if (!cfg) { console.error('No TallyConfig found'); process.exit(1); }

  const company = (cfg.companyName || '').trim().toUpperCase();
  console.log(`Company: "${company}"`);
  console.log(`Connector: ${cfg.useConnector ? cfg.connectorId : 'direct'}`);

  const coTag = company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';

  const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>VoucherTypes</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>
    ${coTag}
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="VoucherTypes">
      <TYPE>VoucherType</TYPE>
      <FETCH>Name, NumberingMethod, IsDeemedPositive, AdditionalName</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

  console.log('\nQuerying Tally for voucher types...');
  const resp = await postXmlWithRetry(cfg, xml, cfg.useConnector ? 90000 : 30000);
  
  const types = [];
  for (const m of resp.matchAll(/<VOUCHERTYPE[^>]*>([\s\S]*?)<\/VOUCHERTYPE>/gi)) {
    const block = m[1];
    const name = (block.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
    if (name) types.push(name);
  }

  console.log(`\n=== Voucher Types in Tally (${types.length} found) ===`);
  types.forEach(t => console.log(`  • "${t}"`));

  if (types.length === 0) {
    console.log('\nRaw response (first 2000 chars):');
    console.log(resp.slice(0, 2000));
  }

  // Check specifically for Sales-type names
  const salesTypes = types.filter(t => t.toLowerCase().includes('sale'));
  console.log(`\nSales-related types: ${salesTypes.map(t => `"${t}"`).join(', ') || '(none found)'}`);

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
