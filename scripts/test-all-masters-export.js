
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

  console.log('Fetching All Masters with Export Data...');
  try {
    const res = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 120000
    });

    console.log(`Got ${res.data.length} bytes`);

    // Search for interesting tags
    const tags = ['LEDGER', 'STOCKITEM', 'STOCKGROUP', 'STOCKCATEGORY', 'UNIT', 'VOUCHERTYPE', 'VOUCHER', 'GROUP'];
    for (const tag of tags) {
      const count = (res.data.match(new RegExp(`<${tag}`, 'gi')) || []).length;
      console.log(`  - <${tag}>: ${count} occurrences`);
    }

    // Show first 4000 chars
    console.log('\nFirst 4000 chars of response:');
    console.log(res.data.slice(0, 4000));

    // Save to file
    const fs = await import('fs');
    const path = await import('path');
    const outputFile = path.join(process.cwd(), 'tally-all-masters-export.xml');
    fs.writeFileSync(outputFile, res.data);
    console.log(`\nSaved to ${outputFile}`);
  } catch (err) {
    console.error('Error:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
  }
}

main().catch(console.error);
