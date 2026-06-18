
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';

async function main() {
  const xml = `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Stock Items Collection</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <REPORT NAME="Stock Items Collection">
            <FORMS>Stock Items Form</FORMS>
          </REPORT>
          <FORM NAME="Stock Items Form">
            <TOPPARTS>Stock Items Part</TOPPARTS>
          </FORM>
          <PART NAME="Stock Items Part">
            <REPEAT>Stock Items : StockItems</REPEAT>
          </PART>
          <COLLECTION NAME="StockItems">
            <TYPE>StockItem</TYPE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
  `.trim();

  console.log('Fetching custom stock items report from Tally...');
  try {
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

    // Show first 3000 chars
    console.log('\nFirst 3000 chars of response:');
    console.log(res.data.slice(0, 3000));
  } catch (err) {
    console.error('Error:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
  }
}

main().catch(console.error);
