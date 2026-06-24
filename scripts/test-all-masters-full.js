
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';

async function main() {
  const xml = `
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>All Masters</REPORTNAME>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </REQUESTDESC>
  </EXPORTDATA></BODY>
</ENVELOPE>
  `.trim();

  console.log('Fetching All Masters from Tally...');
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

  // Let's write the response to a file so we can examine it
  const fs = await import('fs');
  const path = await import('path');
  const outputFile = path.join(process.cwd(), 'tally-all-masters-response.xml');
  fs.writeFileSync(outputFile, res.data);
  console.log(`Wrote response to ${outputFile}`);

  // Show first 2000 chars
  console.log('\nFirst 2000 chars of response:');
  console.log(res.data.slice(0, 2000));
}

main().catch(console.error);
