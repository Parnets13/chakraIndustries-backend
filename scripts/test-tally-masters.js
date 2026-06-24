
import axios from 'axios';
const TALLY_URL = 'http://localhost:9000';

// Test 1: Try different report names
const reportsToTry = [
  'Stock Summary',
  'Stock Item',
  'Stock Items',
  'Stock Register',
  'List of Stock Items',
  'All Masters',
  'Item Master',
  'Inventory Master',
];

async function postXml(xml, desc) {
  console.log(`\n=== Testing: ${desc}`);
  console.log('Request:');
  console.log(xml);
  try {
    const resp = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 60000,
    });
    console.log(`Status: ${resp.status}, Length: ${resp.data.length}`);
    console.log('Preview (first 1000 chars):');
    console.log(resp.data.slice(0, 1000));

    const has = (tag) => resp.data.includes(tag) ? `YES` : `NO`;
    console.log(`Has <STOCKITEM>: ${has('<STOCKITEM')}`);
    console.log(`Has <LEDGER>: ${has('<LEDGER')}`);
    console.log(`Has <VOUCHER>: ${has('<VOUCHER')}`);
    return resp.data;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (err.response) console.error(err.response.data);
    return null;
  }
}

async function main() {
  for (const r of reportsToTry) {
    await postXml(`
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>${r}</REPORTNAME>
      <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
    </REQUESTDESC>
  </EXPORTDATA></BODY>
</ENVELOPE>
`.trim(), `Report "${r}"`);
  }

  // Test 2: Try collection method (using TYPE)
  await postXml(`
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Stock Items</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <REPORT NAME="Stock Items">
            <FORMS>Stock Item Form</FORMS>
          </REPORT>
          <FORM NAME="Stock Item Form">
            <TOPPARTS>Stock Item Part</TOPPARTS>
          </FORM>
          <PART NAME="Stock Item Part">
            <REPEAT>Stock Item Line : Stock Items</REPEAT>
          </PART>
          <COLLECTION NAME="Stock Items">
            <TYPE>StockItem</TYPE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
`.trim(), 'Custom TDL Stock Items Collection');
}

main().catch(console.error);
