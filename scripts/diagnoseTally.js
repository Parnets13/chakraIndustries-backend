/**
 * diagnoseTally.js
 * Sends raw XML requests to Tally and prints the full response
 * so we can see exactly what Tally is returning.
 *
 * Run: node scripts/diagnoseTally.js
 */
import dotenv from 'dotenv';
import axios from 'axios';
import connectDB from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';

dotenv.config();

async function getTallyUrl() {
  const cfg = await TallyConfig.findOne();
  const local = (cfg?.tallyLocalUrl || '').trim();
  const port  = cfg?.port || '9000';
  if (!local) return `http://localhost:${port}`;
  if (local.startsWith('https://') || local.match(/:\d+$/)) return local.replace(/\/$/, '');
  return `${local.replace(/\/$/, '')}:${port}`;
}

async function post(url, xml) {
  try {
    const r = await axios({
      method: 'POST', url,
      data: xml,
      headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
      timeout: 30000, responseType: 'text', validateStatus: () => true,
    });
    return { status: r.status, body: typeof r.data === 'string' ? r.data : String(r.data || '') };
  } catch (e) {
    return { status: 0, body: '', error: e.message };
  }
}

async function run() {
  await connectDB();
  await new Promise(r => setTimeout(r, 2000));

  const url = await getTallyUrl();
  console.log('\n========================================');
  console.log('Tally URL:', url);
  console.log('========================================\n');

  // --- Test 1: List Companies (ping) ---
  console.log('--- TEST 1: List Companies (ping) ---');
  const pingXml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Companies</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
  const ping = await post(url, pingXml);
  console.log('HTTP:', ping.status, '| bytes:', ping.body.length);
  console.log('Response preview:\n', ping.body.slice(0, 600));
  console.log();

  // Extract company name from ping response
  const coMatch = ping.body.match(/<COMPANY[^>]*NAME="([^"]+)"/i) ||
                  ping.body.match(/<NAME[^>]*>(.*?)<\/NAME>/i);
  const company = coMatch ? coMatch[1].trim() : '';
  console.log('Detected company name:', company || '(none found)');
  console.log();

  // --- Test 2: Stock Items ---
  console.log('--- TEST 2: Stock Items ---');
  const itemXml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>List of Stock Items</REPORTNAME>
    <STATICVARIABLES>
      ${company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;
  const items = await post(url, itemXml);
  console.log('HTTP:', items.status, '| bytes:', items.body.length);
  const itemCount = (items.body.match(/<STOCKITEM/gi) || []).length;
  console.log('STOCKITEM tags found:', itemCount);
  console.log('Response preview:\n', items.body.slice(0, 800));
  console.log();

  // --- Test 3: Ledgers ---
  console.log('--- TEST 3: Ledgers ---');
  const ledgerXml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>List of Ledgers</REPORTNAME>
    <STATICVARIABLES>
      ${company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;
  const ledgers = await post(url, ledgerXml);
  console.log('HTTP:', ledgers.status, '| bytes:', ledgers.body.length);
  const ledgerCount = (ledgers.body.match(/<LEDGER/gi) || []).length;
  console.log('LEDGER tags found:', ledgerCount);
  console.log('Response preview:\n', ledgers.body.slice(0, 800));
  console.log();

  // --- Test 4: Day Book (Vouchers) ---
  console.log('--- TEST 4: Day Book (last 30 days) ---');
  const today = new Date();
  const from  = new Date(); from.setDate(from.getDate() - 30);
  const fmt   = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const dayBookXml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>Day Book</REPORTNAME>
    <STATICVARIABLES>
      ${company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVFROMDATE>${fmt(from)}</SVFROMDATE>
      <SVTODATE>${fmt(today)}</SVTODATE>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;
  const daybook = await post(url, dayBookXml);
  console.log('HTTP:', daybook.status, '| bytes:', daybook.body.length);
  const voucherCount = (daybook.body.match(/<VOUCHER/gi) || []).length;
  console.log('VOUCHER tags found:', voucherCount);
  console.log('Response preview:\n', daybook.body.slice(0, 800));
  console.log();

  // --- Test 5: Try alternate report names ---
  console.log('--- TEST 5: Alternate report names ---');
  const altReports = ['Stock Items', 'Ledger', 'Stock Summary', 'List of Accounts'];
  for (const rn of altReports) {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>${rn}</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const r = await post(url, xml);
    const hasData = r.body.includes('<STOCKITEM') || r.body.includes('<LEDGER');
    console.log(`  "${rn}": HTTP ${r.status}, bytes ${r.body.length}, hasData: ${hasData}`);
    if (hasData) console.log('    Preview:', r.body.slice(0, 300));
  }

  process.exit(0);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
