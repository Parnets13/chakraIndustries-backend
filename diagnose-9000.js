import axios from 'axios';
import { execSync } from 'child_process';

console.log('\n╔═════════════════════════════════════════════════════════════════╗');
console.log('║           DIAGNOSTIC: localhost:9000 CONNECTION ISSUE           ║');
console.log('╚═════════════════════════════════════════════════════════════════╝\n');

// 1. Check if port is listening
console.log('📡 STEP 1: Check if port 9000 is LISTENING...\n');
try {
  const output = execSync('netstat -ano | findstr :9000', { encoding: 'utf-8' });
  const lines = output.split('\n').filter(l => l.includes('LISTENING'));
  if (lines.length > 0) {
    console.log('✅ PORT 9000 IS LISTENING');
    console.log('   Listening on: 0.0.0.0:9000');
    const pidMatch = lines[0].match(/\d+$/);
    const pid = pidMatch ? pidMatch[0] : 'Unknown';
    console.log(`   Process ID: ${pid}\n`);
  } else {
    console.log('❌ PORT 9000 IS NOT LISTENING\n');
  }
} catch (e) {
  console.log('⚠️  Could not check port status\n');
}

// 2. Try to connect with timeout
console.log('📡 STEP 2: Try to CONNECT to localhost:9000...\n');
console.log('   Sending test XML to http://localhost:9000');
console.log('   Timeout: 5 seconds\n');

const testXml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>List of Companies</REPORTNAME>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </REQUESTDESC>
  </EXPORTDATA></BODY>
</ENVELOPE>`;

axios({
  method: 'POST',
  url: 'http://localhost:9000',
  data: testXml,
  headers: { 'Content-Type': 'text/xml' },
  timeout: 5000,
  responseType: 'text'
})
.then(response => {
  console.log('✅ CONNECTION SUCCESSFUL!\n');
  console.log('   Status: HTTP ' + response.status);
  console.log('   Response length: ' + response.data.length + ' bytes\n');
  
  if (response.data.includes('ENVELOPE') || response.data.includes('Tally')) {
    console.log('✅ TALLY IS RESPONDING CORRECTLY');
    console.log('\n💡 Next step: Go to /tally/import and sync your items\n');
  } else {
    console.log('⚠️  Tally responded but may not be configured correctly');
    console.log('   Response: ' + response.data.slice(0, 200) + '\n');
  }
})
.catch(error => {
  console.log('❌ CONNECTION FAILED\n');
  console.log('   Error Type: ' + error.code);
  console.log('   Error Message: ' + error.message);
  
  if (error.code === 'ECONNREFUSED') {
    console.log('\n🔴 REASON: Port 9000 is NOT accepting connections');
    console.log('   → Tally\'s HTTP Server is NOT enabled or not running\n');
  } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
    console.log('\n⏳ REASON: Connection TIMED OUT');
    console.log('   → Port 9000 is listening, but Tally is NOT RESPONDING');
    console.log('   → Tally might be busy, locked, or not properly configured\n');
  } else if (error.message.includes('ENOTFOUND')) {
    console.log('\n❌ REASON: localhost:9000 cannot be resolved');
    console.log('   → Network issue or localhost is not accessible\n');
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔧 HOW TO FIX IT:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('1. OPEN Tally Prime');
  console.log('2. Open your company: "SRI CHAKRA INDUSTRIES"');
  console.log('3. Press F12 (Setup menu)');
  console.log('4. Go to: Configure → Advanced Configuration');
  console.log('5. Search for: "Enable ODBC/HTTP Server"');
  console.log('6. Set value to: "Yes"');
  console.log('7. Verify Port is set to: "9000"');
  console.log('8. Click: Accept');
  console.log('9. CLOSE and RESTART Tally completely');
  console.log('10. Then come back and we\'ll test again\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
