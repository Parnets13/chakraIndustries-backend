
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

  console.log('Fetching List of Accounts...');
  const resp = await axios.post(TALLY_URL, xml, {
    headers: { 'Content-Type': 'text/xml', 'Accept': '*/*' },
    timeout: 120000,
    responseType: 'text'
  });
  console.log('Fetched, length:', resp.data.length);

  // search for <VOUCHER starting from 10,000,000 bytes
  const searchStart = 10000000;
  console.log('Searching for vouchers starting at', searchStart);
  const voucherIndex = resp.data.indexOf('<VOUCHER', searchStart);
  if (voucherIndex !== -1) {
    console.log('Found voucher at index', voucherIndex);
    const voucherEnd = resp.data.indexOf('</VOUCHER>', voucherIndex) + 10;
    console.log('Voucher ends at', voucherEnd);
    const voucher = resp.data.slice(voucherIndex, voucherEnd);
    console.log('\n=== Found VOUCHER:');
    console.log(voucher);
  } else {
    console.log('No voucher found');
    // count total number of <VOUCHER tags
    const totalVouchers = (resp.data.match(/<VOUCHER/gi) || []).length;
    console.log('Total <VOUCHER> tags in entire response:', totalVouchers);
  }
}

run();

