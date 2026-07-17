import 'dotenv/config';
import axios from 'axios';

const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CheckDup</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>
    <SVCURRENTCOMPANY>SRI CHAKRA INDUSTRIES</SVCURRENTCOMPANY>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="CheckDup">
      <TYPE>Voucher</TYPE>
      <FETCH>VoucherNumber, Date, VoucherTypeName, PartyLedgerName, Amount</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

const r = await axios.post('http://localhost:9000', xml, {
  headers: { 'Content-Type': 'text/xml' }, timeout: 30000
});
const body = String(r.data);

// Find all voucher numbers
const voucherNos = [...body.matchAll(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/gi)].map(m => m[1].trim());
console.log(`Total vouchers in Tally: ${voucherNos.length}`);

// Check specifically for BIW01
const biw = voucherNos.filter(v => v.toLowerCase().includes('biw'));
console.log('BIW vouchers:', biw.length ? biw : '(none found)');

// Show last 10 vouchers
console.log('Last 10 voucher numbers:', voucherNos.slice(-10));
