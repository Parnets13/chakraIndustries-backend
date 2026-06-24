
import axios from 'axios';
import fs from 'fs';

const TALLY_URL = 'http://localhost:9000';

async function run() {
  console.log('Fetching List of Accounts...');
  const xml = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
 <BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>List of Accounts</REPORTNAME>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
 </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

  const resp = await axios.post(TALLY_URL, xml, {
    headers: { 'Content-Type': 'text/xml', 'Accept': '*/*' },
    timeout: 120000
  });

  // write to file for analysis
  fs.writeFileSync('tally-list-accounts-response.xml', resp.data);
  console.log('Response written to tally-list-accounts-response.xml');

  // get all unique tags
  const tags = resp.data.match(/<[^/][A-Z0-9.]+/gi);
  const uniqueTags = [...new Set(tags)].sort();
  console.log('\nUnique tags found in List of Accounts:');
  console.log(uniqueTags.join('\n'));

  // search for stock-related tags
  const stockTags = uniqueTags.filter(t => t.toLowerCase().includes('stock') || t.toLowerCase().includes('item'));
  console.log('\nStock/item related tags:', stockTags);
}

run();

