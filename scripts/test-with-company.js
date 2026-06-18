
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';
const COMPANY_NAME = 'Sri Chakra Industries';

const reportsToTry = [
  'List of Stock Items',
  'Stock Items',
  'Stock Summary',
  'Stock Item Summary',
  'Stock Book',
  'Item Summary',
  'Stock Item',
  'Day Book',
  'Voucher Register',
  'List of Accounts',
  'List of Ledgers',
  'All Masters'
];

async function testReport(reportName) {
  const xml = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
 <BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>${reportName}</REPORTNAME>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   <SVCURRENTCOMPANY>${COMPANY_NAME}</SVCURRENTCOMPANY>
  </STATICVARIABLES>
 </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

  try {
    const resp = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml', 'Accept': '*/*' },
      timeout: 120000
    });
    const hasStockItem = resp.data.includes('<STOCKITEM');
    const hasLedger = resp.data.includes('<LEDGER');
    const hasVoucher = resp.data.includes('<VOUCHER');
    return {
      name: reportName,
      ok: true,
      status: resp.status,
      length: resp.data.length,
      hasStockItem,
      hasLedger,
      hasVoucher,
      preview: resp.data.slice(0, 1500)
    };
  } catch (err) {
    return { name: reportName, ok: false, error: err.message };
  }
}

async function run() {
  console.log('Testing reports with SVCURRENTCOMPANY:', COMPANY_NAME);
  console.log('='.repeat(80));
  const results = [];
  for (const report of reportsToTry) {
    console.log(`\nTesting ${report}...`);
    const result = await testReport(report);
    results.push(result);
    if (result.ok) {
      console.log(`  Status: ${result.status}, Length: ${result.length}`);
      console.log(`  StockItem: ${result.hasStockItem}, Ledger: ${result.hasLedger}, Voucher: ${result.hasVoucher}`);
    } else {
      console.log(`  Error: ${result.error}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY:');
  for (const r of results) {
    console.log(`  ${r.name}:`, r.ok ? `OK (${r.length} bytes) [SI:${r.hasStockItem}, L:${r.hasLedger}, V:${r.hasVoucher}]` : `FAILED: ${r.error}`);
  }
}

run();

