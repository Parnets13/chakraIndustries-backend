/**
 * Examine the exact XML structure of Collection response inventory entries
 * to understand what tags to parse
 */
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import TallyConfig from '../models/TallyConfig.js';
import mongoose from 'mongoose';

async function main() {
  // Connect to MongoDB first to get Tally config
  await mongoose.connect(process.env.MONGO_URI);
  const config = await TallyConfig.findOne().sort({ updatedAt: -1 });
  const url = (config?.tallyLocalUrl || 'http://localhost') + (config?.tallyLocalUrl?.includes(':') ? '' : ':9000');
  const company = config?.companyName || 'SRI CHAKRA INDUSTRIES';
  console.log('Using Tally URL:', url, 'Company:', company);

  const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AllVch</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>20260601</SVFROMDATE><SVTODATE>20260630</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="AllVch"><TYPE>Voucher</TYPE><FETCH>*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

  console.log('Sending request to Tally...');
  const r = await axios.post(url, xml, { headers: { 'Content-Type': 'text/xml' }, timeout: 30000 });
  const resp = r.data;
  console.log(`Response: ${resp.length} chars`);
  console.log(`Vouchers: ${(resp.match(/<VOUCHER[\s>]/gi)||[]).length}`);

  // Find first sales voucher
  const salesMatch = resp.toLowerCase().indexOf('sales');
  if (salesMatch !== -1) {
    const vStart = resp.lastIndexOf('<VOUCHER', salesMatch);
    const vEnd = resp.indexOf('</VOUCHER>', salesMatch) + 10;
    console.log('\n=== First Sales Voucher ===');
    console.log(resp.slice(vStart, vEnd));
  } else {
    // If no sales, just take first voucher
    const firstVStart = resp.indexOf('<VOUCHER');
    const firstVEnd = resp.indexOf('</VOUCHER>', firstVStart) + 10;
    console.log('\n=== First Voucher ===');
    console.log(resp.slice(firstVStart, firstVEnd));
  }

  // Show all unique tag names in vouchers
  const allTags = [...resp.matchAll(/<([A-Z][A-Z0-9.$_]+)[ >]/g)].map(m=>m[1]);
  console.log('\n=== All unique tags in response ===');
  console.log([...new Set(allTags)].sort().join(', '));

  await mongoose.disconnect();
}

main().catch(console.error);
