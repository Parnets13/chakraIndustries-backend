
import net from 'net';

console.log('Testing Tally with CORRECT XML and headers...');

// THE EXACT XML TALLY EXPECTS FOR "List of Companies"
const xmlBody = `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>List of Companies</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

const contentLength = Buffer.byteLength(xmlBody, 'utf8');
console.log('XML Body length:', contentLength);

const client = net.createConnection({ port: 9000, host: '127.0.0.1' }, () => {
  console.log('✅ Connected to Tally!');
  
  const httpRequest = 
    'POST / HTTP/1.1\r\n' +
    'Host: 127.0.0.1:9000\r\n' +
    'Content-Type: text/xml\r\n' +  // NOT application/xml!
    'Content-Length: ' + contentLength + '\r\n' +
    'Connection: close\r\n' +  // Important to prevent hanging connections
    '\r\n' +
    xmlBody;
  
  console.log('Sending request...');
  console.log('Request headers and XML:\n', httpRequest);
  client.write(httpRequest);
});

let responseBuffer = Buffer.alloc(0);

client.on('data', (data) => {
  responseBuffer = Buffer.concat([responseBuffer, data]);
  console.log('Received', data.length, 'bytes, total:', responseBuffer.length);
});

client.on('end', () => {
  console.log('\n✅ Request complete!');
  console.log('Total response bytes:', responseBuffer.length);
  
  // Try decoding as UTF-8 first (Tally uses UTF-8 usually)
  try {
    const utf8 = responseBuffer.toString('utf8');
    console.log('\nResponse (UTF-8):\n----------------------------------------\n', utf8);
  } catch (e) {
    console.log('UTF-8 decode failed:', e);
  }
  
  client.destroy();
});

client.on('error', (err) => {
  console.error('❌ Error:', err.message);
});

client.setTimeout(60000, () => { // 60 second timeout
  console.error('❌ Timeout after 60 seconds');
  client.destroy();
});
