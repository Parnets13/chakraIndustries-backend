
import axios from 'axios';

async function testConnectivity(url) {
  console.log(`Testing ${url}...`);
  try {
    const respGet = await axios.get(url, { timeout: 10000 });
    console.log(`GET status: ${respGet.status}, length: ${typeof respGet.data === 'string' ? respGet.data.length : 'n/a'}`);
  } catch (e) {
    console.log(`GET failed: ${e.message}`);
  }

  const smallXml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
  try {
    const respPost = await axios.post(url, smallXml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 30000
    });
    console.log(`POST status: ${respPost.status}, length: ${respPost.data.length}`);
    console.log('POST response (first 500 chars):');
    console.log(respPost.data.slice(0, 500));
  } catch (e) {
    console.log(`POST failed: ${e.message}`);
    if (e.response) {
      console.log(e.response.status, e.response.data);
    }
  }
}

testConnectivity('http://localhost:9000');
testConnectivity('http://127.0.0.1:9000');
