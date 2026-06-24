
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';

const reportsToTry = [
  'Stock Summary',
  'Stock Items',
  'Stock Item',
  'Item Summary',
  'Stock Book',
  'Stock Journal',
  'All Masters'
];

async function testReport(reportName) {
  const xml = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
 <BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>${reportName}</REPORTNAME>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
 </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

  try {
    const resp = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml', 'Accept': '*/*' },
      timeout: 60000
    });
    const hasStockItem = resp.data.includes('<STOCKITEM');
    return { name: reportName, ok: true, status: resp.status, length: resp.data.length, hasStockItem, preview: resp.data.slice(0, 1000) };
  } catch (err) {
    return { name: reportName, ok: false, error: err.message };
  }
}

async function run() {
  for (const report of reportsToTry) {
    console.log('\n=== Testing:', report, '===');
    const result = await testReport(report);
    if (result.ok) {
      console.log('HTTP:', result.status, 'Length:', result.length);
      console.log('Has <STOCKITEM>:', result.hasStockItem);
      if (result.hasStockItem) {
        console.log('Preview:\n', result.preview);
        // count stock items
        const count = (result.preview.match(/<STOCKITEM/gi) || []).length;
        console.log('Stock items in preview:', count);
      }
    } else {
      console.log('Error:', result.error);
    }
  }
}

run();

