import axios from 'axios';

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║         WHY IS IMPORT FROM TALLY SO SLOW? - DIAGNOSTIC           ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

const TALLY_URL = 'http://localhost:9000';

async function testConnection() {
  console.log('📡 STEP 1: Testing connection to Tally...\n');
  
  const xml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>List of Stock Items</REPORTNAME>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>SRI CHAKRA INDUSTRIES</SVCURRENTCOMPANY>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </REQUESTDESC>
  </EXPORTDATA></BODY>
</ENVELOPE>`;

  try {
    console.log('   Sending request to:', TALLY_URL);
    console.log('   Request type: List of Stock Items');
    console.log('   Timeout: 10 seconds\n');
    
    const startTime = Date.now();
    const response = await axios({
      method: 'POST',
      url: TALLY_URL,
      data: xml,
      headers: { 'Content-Type': 'text/xml' },
      timeout: 10000,
      responseType: 'text'
    });
    const responseTime = Date.now() - startTime;

    console.log(`✅ RESPONSE RECEIVED\n`);
    console.log(`   Status: HTTP ${response.status}`);
    console.log(`   Time taken: ${responseTime}ms`);
    console.log(`   Response size: ${response.data.length} bytes\n`);

    // Count items in response
    const itemMatches = response.data.match(/<STOCKITEM/gi) || [];
    console.log(`📦 STOCK ITEMS FOUND: ${itemMatches.length}\n`);

    if (responseTime > 5000) {
      console.log('⚠️  SLOW RESPONSE!');
      console.log(`   Took ${responseTime}ms - Tally is responding slowly\n`);
    } else {
      console.log('✅ Response time is good\n');
    }

    // Check if response is complete
    if (!response.data.includes('</ENVELOPE>')) {
      console.log('⚠️  WARNING: Response may be incomplete or truncated\n');
    }

  } catch (error) {
    console.log(`❌ CONNECTION ERROR\n`);
    console.log(`   Error: ${error.message}`);
    console.log(`   Code: ${error.code}\n`);

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.log('🔴 ISSUE: Tally is NOT RESPONDING in time');
      console.log('   → Tally may be busy or hung');
      console.log('   → Try: Restart Tally Prime\n');
    }
    return false;
  }

  return true;
}

async function main() {
  const connected = await testConnection();

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                     COMMON CAUSES                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('⏳ IMPORT STUCK AT [1/8] Items - REASONS:\n');

  console.log('1️⃣  TALLY IS NOT RESPONDING');
  console.log('   → Tally is busy or stuck');
  console.log('   → Solution: Restart Tally Prime completely\n');

  console.log('2️⃣  NETWORK/CONNECTION TIMEOUT');
  console.log('   → Tally response takes >30 seconds');
  console.log('   → Solution: Increase timeout in code (see below)\n');

  console.log('3️⃣  TALLY HTTP SERVER NOT ENABLED');
  console.log('   → Even though port 9000 is open, HTTP server not configured');
  console.log('   → Solution: F12 → Configure → Enable ODBC/HTTP: Yes\n');

  console.log('4️⃣  LARGE DATASET IN TALLY');
  console.log('   → If you have 1000+ items, Tally takes time to fetch');
  console.log('   → Solution: Wait longer (2-5 minutes) or filter items\n');

  console.log('5️⃣  DATABASE CONNECTION SLOW');
  console.log('   → MongoDB is slow, slowing down the import process');
  console.log('   → Solution: Check MongoDB connection\n');

  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log('✅ WHAT TO DO NOW:\n');

  console.log('Option A: WAIT (Might work if Tally is just slow)');
  console.log('   → Wait 2-3 more minutes without clicking Cancel');
  console.log('   → If still stuck after 5 minutes → Cancel and restart Tally\n');

  console.log('Option B: RESTART TALLY (Most likely to fix)');
  console.log('   1. Click "Cancel" on the import');
  console.log('   2. Close Tally Prime completely');
  console.log('   3. Wait 10 seconds');
  console.log('   4. Restart Tally Prime');
  console.log('   5. Try import again\n');

  console.log('Option C: IMPORT SPECIFIC ITEMS ONLY');
  console.log('   1. Cancel the import');
  console.log('   2. Go to /tally/import');
  console.log('   3. Click "Import Items" button (not "Full")');
  console.log('   4. Wait for just Items to complete\n');

  console.log('═══════════════════════════════════════════════════════════════════\n');

  if (connected) {
    console.log('✅ Tally is responding - try restarting the import');
  } else {
    console.log('❌ Tally is NOT responding - RESTART TALLY NOW');
  }

  console.log('\n');
}

main().catch(console.error);
