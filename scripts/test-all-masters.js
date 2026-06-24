
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';

const xml = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
 <BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>All Masters</REPORTNAME>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
 </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

async function run() {
  try {
    const resp = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml', 'Accept': '*/*' },
      timeout: 60000
    });
    console.log('All Masters report:');
    console.log('Length:', resp.data.length);
    console.log('\nPreview (first 5000 chars):');
    console.log(resp.data.slice(0, 5000));
    console.log('\nTags:');
    const tags = resp.data.match(/<[A-Z]+/g);
    const uniqueTags = [...new Set(tags)];
    console.log(uniqueTags);
    console.log('\nCounts:');
    console.log('  <CURRENCY>:', (resp.data.match(/<CURRENCY/gi) || []).length);
    console.log('  <UNIT>:', (resp.data.match(/<UNIT/gi) || []).length);
    console.log('  <STOCKGROUP>:', (resp.data.match(/<STOCKGROUP/gi) || []).length);
    console.log('  <STOCKITEM>:', (resp.data.match(/<STOCKITEM/gi) || []).length);
    console.log('  <LEDGER>:', (resp.data.match(/<LEDGER/gi) || []).length);
  } catch (err) {
    console.error('Error:', err);
  }
}

run();

