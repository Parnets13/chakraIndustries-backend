
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';

async function test() {
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
    timeout: 120000,
    responseType: 'text'
  });

  // Find first LEDGER with <PARENT>Sundry Debtors</PARENT>
  const regex = /<LEDGER([^>]*)>([\s\S]*?)<\/LEDGER>/gi;
  let match;
  let found = false;
  while ((match = regex.exec(resp.data)) !== null && !found) {
    const attrs = match[1];
    const block = match[2];
    if (block.includes('<PARENT>Sundry Debtors</PARENT>') || block.includes('<PARENT>Sundry Creditors</PARENT>')) {
      console.log('FOUND LEDGER:');
      console.log('ATTRIBUTES:', attrs);
      console.log('BLOCK:', block);
      found = true;
    }
  }
}

test();
