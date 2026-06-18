
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';
const COMPANY_NAME = 'Sri Chakra Industries'; // Update this if your company name is different

async function testAllMasters() {
  const xml = `
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${COMPANY_NAME}</SVCURRENTCOMPANY>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>
  `.trim();

  console.log('Testing All Masters report with company...');
  try {
    const resp = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
      timeout: 120000
    });

    console.log(`Status: ${resp.status}, Length: ${resp.data.length}`);
    console.log('\nResponse preview (first 4000 chars):');
    console.log(resp.data.slice(0, 4000));

    // Check for tags
    const tags = ['STOCKITEM', 'LEDGER', 'GROUP', 'STOCKGROUP', 'UNIT', 'GODOWN', 'CURRENCY'];
    tags.forEach(tag => {
      const count = (resp.data.match(new RegExp(`<${tag}`, 'gi')) || []).length;
      console.log(`\n<${tag}>: ${count} occurrences`);
    });

  } catch (err) {
    console.error('Error:', err.message);
    if (err.response) {
      console.error('Response status:', err.response.status);
      console.error('Response data:', err.response.data);
    }
  }
}

testAllMasters();
