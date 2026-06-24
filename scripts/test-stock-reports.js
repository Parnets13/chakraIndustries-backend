
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';

async function testReport(reportName) {
  const xml = `
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${reportName}</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>
  `.trim();

  try {
    const res = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 15000
    });
    const hasStockItem = res.data.includes('STOCKITEM');
    console.log(`✓ Report "${reportName}" returned ${res.data.length} bytes. Has STOCKITEM: ${hasStockItem}`);
    if (hasStockItem) {
      console.log('  Preview:', res.data.slice(0, 500));
    }
    return hasStockItem;
  } catch (e) {
    console.log(`✗ Report "${reportName}" failed:`, e.message);
    return false;
  }
}

async function main() {
  const reports = [
    'Stock Summary',
    'Stock Item',
    'Stock Items',
    'Stock Register',
    'Stock Journal',
    'Stock Category Summary',
    'Stock Group Summary',
    'Stock Query',
    'Stock Item Voucher',
    'List of Stock Items',
    'All Masters',
    'Stock Item Master',
    'Stock Master',
    'Item Master',
    'Inventory Master',
    'Stock Details',
    'Stock List',
    'Item List',
    'Stock Item List',
    'Stock Item Summary',
    'Stock Item Register',
    'Stock Item Master List',
    'Inventory Summary',
    'Inventory List',
    'Inventory Register',
    'Inventory Master List',
    'Stock Item Master Summary',
  ];

  console.log('Testing Tally stock reports...');
  const results = [];
  for (const r of reports) {
    const ok = await testReport(r);
    results.push({ name: r, ok });
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n\nResults:');
  console.log('Valid reports:', results.filter(r => r.ok).map(r => r.name));
}

main().catch(console.error);
