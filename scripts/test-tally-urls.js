
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function testUrl(url, label) {
  console.log(`\n=== Testing ${label}: ${url}`);
  try {
    const smallXml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const resp = await axios.post(url, smallXml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 30000,
      validateStatus: () => true
    });
    console.log(`✅ Status: ${resp.status}`);
    console.log(`✅ Response length: ${typeof resp.data.length} bytes`);
    if (resp.data && resp.data.length > 200) console.log(`✅ Preview: ${resp.data.substring(0, 500)}`);
    return resp.data;
  } catch (e) {
    console.error(`❌ Error: ${e.message}`);
    if (e.response) console.error(e.response.status, e.response.data);
    return null;
  }
}

async function main() {
  await testUrl('http://localhost:9000', 'localhost:9000');
  await testUrl('https://erp.majesticmall.net', 'serverUrl');
}

main();
