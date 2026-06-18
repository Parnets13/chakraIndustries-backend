
import axios from 'axios';
const TALLY_URL = 'http://localhost:9000';
const xml = `
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>List of Accounts</REPORTNAME>
      <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
    </REQUESTDESC>
  </EXPORTDATA></BODY>
</ENVELOPE>
`.trim();

console.log('Testing List of Accounts...');
try {
  const resp = await axios.post(TALLY_URL, xml, {
    headers: { 'Content-Type': 'text/xml' },
    timeout: 120000,
  });
  console.log(`SUCCESS! Status: ${resp.status}, Length: ${resp.data.length}`);
  
  const tags = ['LEDGER', 'STOCKITEM', 'VOUCHERTYPENAME', 'VOUCHER'];
  for (const tag of tags) {
    const matches = resp.data.match(new RegExp(`<${tag}`, 'gi'));
    const count = matches ? matches.length : 0;
    console.log(`<${tag}> count: ${count}`);
  }

  // Write to file for inspection
  const fs = await import('fs');
  const path = await import('path');
  const file = path.join(process.cwd(), 'list-of-accounts-response.xml');
  fs.writeFileSync(file, resp.data);
  console.log(`Wrote response to ${file}`);

  // Find a small snippet containing all tags
  console.log('\nFirst 2000 chars:');
  console.log(resp.data.slice(0, 2000));

} catch (err) {
  console.error(err.message);
  if (err.response) console.error(err.response.data);
}
