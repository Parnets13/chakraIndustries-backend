/**
 * testTallyUrl.mjs
 * Tests whether a URL responds like Tally Prime (XML response)
 * or like the ERP (JSON response).
 *
 * Usage: node scripts/testTallyUrl.mjs [url]
 * e.g.:  node scripts/testTallyUrl.mjs https://erp.majesticmall.net
 */
import axios from 'axios';

const testUrls = [
  process.argv[2],           // command line arg if provided
  'http://localhost:9000',   // Tally default local
  'https://erp.majesticmall.net',  // ERP / possible tunnel
].filter(Boolean);

const TALLY_XML = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>List of Companies</REPORTNAME>
  <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

for (const url of testUrls) {
  process.stdout.write(`\nTesting: ${url} ... `);
  try {
    const r = await axios.post(url, TALLY_XML, {
      headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
      timeout: 8000,
      responseType: 'text',
      validateStatus: () => true,
    });
    const body = String(r.data || '').slice(0, 300);
    const isTally = body.includes('<ENVELOPE>') || body.includes('<COMPANY') || body.includes('<TALLYMESSAGE');
    const isERP   = body.includes('"success"') || body.includes('"ok"') || body.includes('<!DOCTYPE');

    if (isTally) {
      console.log(`✅ TALLY PRIME FOUND (HTTP ${r.status})`);
      console.log('   Response preview:', body.slice(0, 120));
    } else if (isERP) {
      console.log(`❌ This is the ERP server, NOT Tally (HTTP ${r.status})`);
      console.log('   Response preview:', body.slice(0, 120));
    } else {
      console.log(`⚠️  Got response (HTTP ${r.status}) — unknown server`);
      console.log('   Response preview:', body.slice(0, 120));
    }
  } catch (e) {
    const code = e.code || e.message;
    if (code === 'ECONNREFUSED')     console.log('❌ Connection refused — not running');
    else if (code === 'ECONNRESET')  console.log('⚠️  Connection reset — server up but closed connection (Tally HTTP not fully enabled?)');
    else if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') console.log('❌ Timeout — not reachable');
    else console.log(`❌ Error: ${code}`);
  }
}
console.log('\nDone.');
process.exit(0);
