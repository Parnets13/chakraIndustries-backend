import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const TALLY_URL = 'http://localhost:9000';

async function postToTally(xml) {
  try {
    const response = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 30000,
      responseType: 'text'
    });
    return response.data;
  } catch (error) {
    console.error('Error connecting to Tally:', error.message);
    return null;
  }
}

function extractXmlValue(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         CHECKING WHAT ITEMS ARE REALLY IN TALLY            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Test connection first
  console.log('📡 Testing connection to Tally at:', TALLY_URL);
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

  let resp = await postToTally(testXml);
  if (!resp) {
    console.log('❌ Cannot connect to Tally. Is it running on port 9000?');
    process.exit(1);
  }
  console.log('✅ Connected to Tally!\n');

  // Get list of stock items
  console.log('📦 Fetching all STOCK ITEMS from Tally...\n');
  const itemListXml = `<ENVELOPE>
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

  resp = await postToTally(itemListXml);
  if (!resp || !resp.includes('<STOCKITEM')) {
    console.log('⚠️  No stock items found in "List of Stock Items" report');
    console.log('Trying "Stock Summary" report...\n');
    
    const sumXml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>Stock Summary</REPORTNAME>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>SRI CHAKRA INDUSTRIES</SVCURRENTCOMPANY>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </REQUESTDESC>
  </EXPORTDATA></BODY>
</ENVELOPE>`;

    resp = await postToTally(sumXml);
  }

  if (!resp) {
    console.log('❌ No response from Tally');
    process.exit(1);
  }

  // Parse stock items
  const stockItemMatches = resp.matchAll(/<STOCKITEM[^>]*NAME="([^"]+)"[^>]*>([\s\S]*?)<\/STOCKITEM>/gi);
  const items = [];
  
  for (const match of stockItemMatches) {
    const name = match[1];
    const block = match[2] || '';
    
    const hsn = extractXmlValue(block, 'HSNCODE') || 'N/A';
    const gst = extractXmlValue(block, 'GSTRATE') || '0';
    const unit = extractXmlValue(block, 'BASEUNITS') || 'Nos';
    const guid = extractXmlValue(block, 'GUID');
    
    items.push({ name, hsn, gst, unit, guid });
  }

  // Also try parsing from display names in Stock Summary
  if (items.length === 0) {
    const displayMatches = resp.matchAll(/<DSPDISPNAME>([\s\S]*?)<\/DSPDISPNAME>/gi);
    const seen = new Set();
    for (const match of displayMatches) {
      const name = match[1]?.trim();
      if (name && name !== 'Name' && !seen.has(name)) {
        seen.add(name);
        items.push({ name, hsn: 'N/A', gst: 'N/A', unit: 'N/A' });
      }
    }
  }

  console.log(`\n🔍 TOTAL STOCK ITEMS FOUND IN TALLY: ${items.length}\n`);
  console.log('═════════════════════════════════════════════════════════════\n');

  if (items.length === 0) {
    console.log('❌ No items found in Tally');
    console.log('\nRaw XML response (first 2000 chars):');
    console.log(resp.slice(0, 2000));
  } else {
    items.forEach((item, index) => {
      console.log(`${index + 1}. ${item.name.padEnd(40)}`);
      console.log(`   HSN: ${item.hsn}, GST: ${item.gst}%, Unit: ${item.unit}`);
      if (item.guid) console.log(`   Tally GUID: ${item.guid}`);
      console.log();
    });
  }

  console.log('═════════════════════════════════════════════════════════════');
  console.log('\n📌 COMPARISON:');
  console.log('   Items in Tally: ' + items.length);
  console.log('   Items in ERP (from last import): 7');
  console.log('   Items you say you created: 3');
  console.log('\n💭 If Tally shows only 3 items, then the ERP has 4 EXTRA items');
  console.log('   that shouldn\'t be there - they may be old or test data.\n');
}

main().catch(console.error);
