
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';

async function main() {
  const xml = `
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>List of Accounts</REPORTNAME>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </REQUESTDESC>
  </EXPORTDATA></BODY>
</ENVELOPE>
  `.trim();

  console.log('Fetching List of Accounts from Tally...');
  const res = await axios.post(TALLY_URL, xml, {
    headers: { 'Content-Type': 'text/xml' },
    timeout: 60000
  });

  console.log(`Got ${res.data.length} bytes`);

  // Search for interesting tags
  const tags = ['LEDGER', 'STOCKITEM', 'STOCKGROUP', 'STOCKCATEGORY', 'UNIT', 'VOUCHERTYPE', 'VOUCHER'];
  for (const tag of tags) {
    const count = (res.data.match(new RegExp(`<${tag}`, 'gi')) || []).length;
    console.log(`  - <${tag}>: ${count} occurrences`);
  }

  // Find first STOCKITEM if present
  if (res.data.includes('<STOCKITEM')) {
    const idx = res.data.indexOf('<STOCKITEM');
    const endIdx = res.data.indexOf('</STOCKITEM>', idx) + '</STOCKITEM>'.length;
    console.log('\nFirst STOCKITEM:');
    console.log(res.data.slice(idx, Math.min(endIdx, idx + 2000)));
  }
}

main().catch(console.error);
