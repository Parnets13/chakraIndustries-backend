
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';

async function testStockItemReport() {
  const xml = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
 <BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>Stock Item</REPORTNAME>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
 </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

  const resp = await axios.post(TALLY_URL, xml, {
    headers: { 'Content-Type': 'text/xml', 'Accept': '*/*' },
    timeout: 60000
  });
  
  console.log('Stock Item report response:');
  console.log('Total length:', resp.data.length);
  console.log('\nFull response:');
  console.log(resp.data);
  
  // check what tags are present
  const tags = resp.data.match(/<[A-Z]+/g);
  const uniqueTags = [...new Set(tags)];
  console.log('\nUnique tags found:', uniqueTags);
}

testStockItemReport();

