
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';

async function testTdlStockItems() {
  const xml = `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>StockItemList</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <REPORT NAME="StockItemList">
            <FORMS>StockItemForm</FORMS>
          </REPORT>
          <FORM NAME="StockItemForm">
            <TOPPARTS>StockItemPart</TOPPARTS>
          </FORM>
          <PART NAME="StockItemPart">
            <REPEAT>StockItemLine : StockItems</REPEAT>
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

  console.log('Testing custom TDL StockItem collection report...');
  try {
    const resp = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
      timeout: 60000
    });

    console.log(`Status: ${resp.status}, Length: ${resp.data.length}`);
    console.log('\nFull response:');
    console.log(resp.data);

    // Check for tags
    const tags = ['STOCKITEM', 'LEDGER', 'GROUP', 'COLLECTION', 'DATA', 'REPORT', 'FORM', 'PART', 'LINE'];
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

testTdlStockItems();
