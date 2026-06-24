/**
 * testTallyLocal.js
 * Quick test: pings local Tally at http://localhost:9000
 * and sends a small master (1 ledger) to verify data actually lands in Tally.
 *
 * Run: node scripts/testTallyLocal.js
 */
import axios from 'axios';

const URL     = 'http://localhost:9000';
const COMPANY = 'SRI CHAKRA INDUSTRIES';

async function post(xml) {
  const r = await axios({
    method: 'POST', url: URL, data: xml,
    headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
    timeout: 15000, responseType: 'text', validateStatus: () => true,
  });
  return { status: r.status, body: String(r.data || '') };
}

// ── Step 1: Ping ──────────────────────────────────────────────────────────────
console.log(`\n1. Pinging Tally at ${URL}...`);
const pingXml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>List of Companies</REPORTNAME>
    <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

try {
  const { status, body } = await post(pingXml);
  console.log(`   HTTP ${status}`);
  console.log(`   Response: ${body.slice(0, 300)}`);
} catch (e) {
  console.error('   ❌ FAILED:', e.message);
  console.error('   → Make sure Tally Prime is open and HTTP Server is enabled (F12 → Configure → Advanced → Enable ODBC: Yes, Port: 9000)');
  process.exit(1);
}

// ── Step 2: Send 1 test ledger ─────────────────────────────────────────────────
console.log(`\n2. Sending test ledger to company: ${COMPANY}...`);
const testLedgerXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>All Masters</REPORTNAME>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="ERP Test Ledger 001" ACTION="Create">
        <NAME>ERP Test Ledger 001</NAME>
        <PARENT>Sundry Debtors</PARENT>
        <OPENINGBALANCE>0</OPENINGBALANCE>
        <ISBILLWISEON>Yes</ISBILLWISEON>
      </LEDGER>
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

try {
  const { status, body } = await post(testLedgerXml);
  console.log(`   HTTP ${status}`);
  console.log(`   Response: ${body.slice(0, 500)}`);

  if (body.includes('<CREATED>1</CREATED>') || body.includes('<ALTERED>1</ALTERED>')) {
    console.log('\n   ✅ SUCCESS! Test ledger created/altered in Tally.');
    console.log('   → Open Tally → Accounts Info → Ledgers → look for "ERP Test Ledger 001"');
  } else if (body.includes('<LINEERROR>')) {
    const err = body.match(/<LINEERROR>(.*?)<\/LINEERROR>/)?.[1];
    console.log(`\n   ⚠️  Tally returned an error: ${err}`);
    if (err?.includes('already exists') || err?.includes('exist')) {
      console.log('   → Ledger already exists in Tally — this is fine! Export is working.');
    }
  } else if (body.includes('<CREATED>0</CREATED>') && body.includes('<ALTERED>0</ALTERED>')) {
    console.log('\n   ⚠️  Created:0 Altered:0 — Tally accepted the request but made no changes.');
    console.log('   → Possible reason: Wrong company name. Check SVCURRENTCOMPANY matches exactly.');
    console.log('   → Go to Tally → Gateway of Tally — the company shown there is the exact name to use.');
  } else {
    console.log('\n   ℹ️  Unexpected response — check above for details.');
  }
} catch (e) {
  console.error('   ❌ FAILED:', e.message);
}

// ── Step 3: Send 1 test stock item ─────────────────────────────────────────────
console.log(`\n3. Sending test stock item...`);
const testItemXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>All Masters</REPORTNAME>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <STOCKITEM NAME="ERP Test Item 001" ACTION="Create">
        <NAME>ERP Test Item 001</NAME>
        <PARENT>Primary</PARENT>
        <UNITS>Nos</UNITS>
        <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>
        <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
        <GSTRATE>18</GSTRATE>
      </STOCKITEM>
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

try {
  const { status, body } = await post(testItemXml);
  console.log(`   HTTP ${status}`);
  console.log(`   Response: ${body.slice(0, 500)}`);

  if (body.includes('<CREATED>1</CREATED>') || body.includes('<ALTERED>1</ALTERED>')) {
    console.log('\n   ✅ SUCCESS! Test stock item created/altered in Tally.');
    console.log('   → Open Tally → Inventory Info → Stock Items → look for "ERP Test Item 001"');
  } else {
    const err = body.match(/<LINEERROR>(.*?)<\/LINEERROR>/)?.[1];
    if (err?.includes('already exists') || err?.includes('exist')) {
      console.log('   ✅ Item already exists in Tally — export is working!');
    } else {
      console.log('   ℹ️  Check response above.');
    }
  }
} catch (e) {
  console.error('   ❌ FAILED:', e.message);
}

console.log('\n─────────────────────────────────────────');
console.log('Done. If both steps succeeded → ERP → Tally export is working!');
console.log('Now restart backend and run "Export to Tally" from the ERP.');
console.log('─────────────────────────────────────────\n');
