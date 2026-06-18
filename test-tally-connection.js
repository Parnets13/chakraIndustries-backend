
import axios from 'axios';

const testXml = '<ENVELOPE>\n  <HEADER>\n    <TALLYREQUEST>Export Data</TALLYREQUEST>\n  </HEADER>\n  <BODY>\n    <EXPORTDATA>\n      <REQUESTDESC>\n        <REPORTNAME>List of Companies</REPORTNAME>\n        <STATICVARIABLES>\n          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>\n        </STATICVARIABLES>\n      </REQUESTDESC>\n    </EXPORTDATA>\n  </BODY>\n</ENVELOPE>';

console.log('Testing connection to http://localhost:9000...');

axios({
  method: 'POST',
  url: 'http://localhost:9000',
  data: testXml,
  headers: { 'Content-Type': 'text/xml' },
  timeout: 15000,
  responseType: 'text'
})
  .then(response => {
    console.log('✅ CONNECTION SUCCESSFUL!');
    console.log('Status:', response.status);
    console.log('Response preview:', response.data.slice(0, 500));
  })
  .catch(error => {
    console.log('❌ CONNECTION FAILED');
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  });
