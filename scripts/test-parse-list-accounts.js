
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';
const COMPANY_NAME = 'Sri Chakra Industries';

async function run() {
  const xml = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
 <BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>List of Accounts</REPORTNAME>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   <SVCURRENTCOMPANY>${COMPANY_NAME}</SVCURRENTCOMPANY>
  </STATICVARIABLES>
 </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

  const resp = await axios.post(TALLY_URL, xml, {
    headers: { 'Content-Type': 'text/xml', 'Accept': '*/*' },
    timeout: 120000
  });

  // find first LEDGER
  const firstLedgerIndex = resp.data.indexOf('<LEDGER');
  if (firstLedgerIndex !== -1) {
    const firstLedgerEnd = resp.data.indexOf('</LEDGER>', firstLedgerIndex) + 9;
    const firstLedger = resp.data.slice(firstLedgerIndex, firstLedgerEnd);
    console.log('=== First LEDGER entry:');
    console.log(firstLedger);
  }

  // find first VOUCHER
  const firstVoucherIndex = resp.data.indexOf('<VOUCHER');
  if (firstVoucherIndex !== -1) {
    const firstVoucherEnd = resp.data.indexOf('</VOUCHER>', firstVoucherIndex) + 10;
    const firstVoucher = resp.data.slice(firstVoucherIndex, firstVoucherEnd);
    console.log('\n=== First VOUCHER entry:');
    console.log(firstVoucher);
  }
}

run();

