
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';

async function testTdlCollection() {
  const xml = `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllStockItems</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllStockItems">
            <TYPE>StockItem</TYPE>
            <NATIVETYPE>StockItem</NATIVETYPE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
  `.trim();

  console.log('Testing custom TDL StockItem collection...');
  try {
    const resp = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
      timeout: 60000
    });

    console.log(`Status: ${resp.status}, Length: ${resp.data.length}`);
    console.log('\nResponse preview (first 2000 chars):');
    console.log(resp.data.slice(0, 2000));

    // Check for tags
    const tags = ['STOCKITEM', 'LEDGER', 'GROUP', 'COLLECTION', 'DATA'];
    tags.forEach(tag => {
      const count = (resp.data.match(new RegExp(`<${tag}`, 'gi')) || []).length;
      console.log(`\n<${tag}>: ${count} occurrences`);
    });

  } catch (err) {
    console.error('Error:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
  }
}

testTdlCollection();
