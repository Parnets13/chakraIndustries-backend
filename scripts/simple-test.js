
import axios from 'axios';
const TALLY_URL = 'http://localhost:9000';

async function testRequest(xml, desc) {
  console.log(`\n=== Testing: ${desc} ===`);
  try {
    const resp = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
      timeout: 30000
    });
    console.log('HTTP Status:', resp.status);
    console.log('Response Length:', resp.data.length);
    const tags = ['STOCKITEM', 'LEDGER', 'STOCKGROUP', 'UNIT', 'VOUCHER', 'COMPANY'];
    tags.forEach(tag => {
      const count = (resp.data.match(new RegExp(`<${tag}`, 'gi')) || []).length;
      console.log(`  <${tag}>: ${count}`);
    });
    console.log('Preview (first 1500 chars):');
    console.log(resp.data.slice(0, 1500));
    return resp.data;
  } catch (err) {
    console.error('Error:', err.message);
    if (err.response) console.error('Response:', err.response.status, err.response.data);
    return null;
  }
}

async function main() {
  // Test 1: List of Accounts
  await testRequest(`
<ENVELOPE>
 <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
 <BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>List of Accounts</REPORTNAME>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
 </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>
  `.trim(), 'List of Accounts');

  // Test 2: List of Companies
  await testRequest(`
<ENVELOPE>
 <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
 <BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>List of Companies</REPORTNAME>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
 </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>
  `.trim(), 'List of Companies');

  // Test 3: Try with TDL Collection (simpler version)
  await testRequest(`
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>StockItems</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="StockItems">
            <TYPE>StockItem</TYPE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
  `.trim(), 'TDL Collection for StockItems');
}

main();
