
import net from 'net';

console.log('Testing Tally with original-style XML...');

const xmlBody1 = '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Companies</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>';
const xmlBody2 = '<ENVELOPE>\n  <HEADER>\n    <VERSION>1</VERSION>\n    <TALLYREQUEST>Export</TALLYREQUEST>\n    <TYPE>Data</TYPE>\n    <ID>List of Companies</ID>\n  </HEADER>\n  <BODY>\n    <EXPORTDATA>\n      <REQUESTDESC>\n        <REPORTNAME>List of Companies</REPORTNAME>\n        <REPORTTYPE>Collection</REPORTTYPE>\n        <STATICVARIABLES>\n          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>\n        </STATICVARIABLES>\n      </REQUESTDESC>\n    </EXPORTDATA>\n  </BODY>\n</ENVELOPE>';

function testXml(xml, label) {
  return new Promise((resolve) => {
    const contentLength = Buffer.byteLength(xml, 'utf8');
    console.log(`\n--- Testing ${label} ---`);
    console.log(`XML length: ${contentLength}`);
    console.log(`XML:\n${xml}`);

    const client = net.createConnection({ port: 9000, host: '127.0.0.1' }, () => {
      console.log('Connected!');
      const httpRequest = 
        'POST / HTTP/1.1\r\n' +
        'Host: 127.0.0.1:9000\r\n' +
        'Content-Type: text/xml\r\n' +
        `Content-Length: ${contentLength}\r\n` +
        '\r\n' +
        xml;
      console.log('Sending request...');
      client.write(httpRequest);
    });

    let responseBuffer = Buffer.alloc(0);

    client.on('data', (data) => {
      responseBuffer = Buffer.concat([responseBuffer, data]);
      console.log(`Received ${data.length} bytes, total ${responseBuffer.length}`);
    });

    client.on('end', () => {
      console.log('Request complete!');
      console.log('Total bytes:', responseBuffer.length);
      try {
        const utf8 = responseBuffer.toString('utf8');
        console.log('\nUTF-8 response:');
        console.log(utf8);
      } catch (e) {
        console.error('UTF-8 decode failed');
      }
      try {
        const utf16 = responseBuffer.toString('utf16le');
        console.log('\nUTF-16LE response:');
        console.log(utf16);
      } catch (e) {
        console.error('UTF-16LE decode failed');
      }
      client.end();
      resolve();
    });

    client.on('error', (err) => {
      console.error('Error:', err.message);
      resolve();
    });

    client.setTimeout(30000, () => {
      console.error('Timeout after 30 seconds');
      client.destroy();
      resolve();
    });
  });
}

async function runTests() {
  await testXml(xmlBody1, 'Short original style');
  await testXml(xmlBody2, 'Long original style');
}

runTests();
