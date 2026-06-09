import axios from 'axios';

const urls = [
  'http://localhost:9000',
  'http://127.0.0.1:9000',
  'http://localhost:9001',
  'https://erp.majesticmall.net',
];

const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Companies</REPORTNAME>
<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

console.log('Testing Tally connectivity...\n');

for (const url of urls) {
  try {
    const r = await axios.post(url, xml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 5000,
      responseType: 'text',
      validateStatus: () => true,
    });
    const preview = String(r.data || '').slice(0, 120).replace(/\n/g, ' ');
    console.log(`✅ ${url} → HTTP ${r.status} (${String(r.data||'').length} bytes)`);
    console.log(`   Preview: ${preview}`);
  } catch (e) {
    console.log(`❌ ${url} → ${e.code || e.message}`);
  }
}
process.exit(0);
