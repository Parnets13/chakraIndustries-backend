import dotenv from 'dotenv';
import axios from 'axios';
import connectDB from './config/database.js';
import TallyConfig from './models/TallyConfig.js';

dotenv.config();

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         CAPTURE TALLY XML RESPONSE FOR ANALYSIS               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  await connectDB();

  const cfg = await TallyConfig.findOne();
  if (!cfg?.tallyLocalUrl) {
    console.log('❌ Tally Local URL not configured!');
    process.exit(1);
  }

  const port = cfg.port || '9000';
  let baseUrl = cfg.tallyLocalUrl || '';
  if (!baseUrl.startsWith('https://') && !baseUrl.match(/:\d+$/)) {
    baseUrl = `${baseUrl}:${port}`;
  }
  baseUrl = baseUrl.replace(/\/$/, '');

  console.log(`📡 Tally URL: ${baseUrl}`);
  console.log(`🏢 Company: ${cfg.companyName || 'SRI CHAKRA INDUSTRIES'}\n`);

  // Build a simple Day Book export request for ONE DAY (June 18, 2026)
  const company = cfg.companyName || 'SRI CHAKRA INDUSTRIES';
  const fromDate = '20260618';  // June 18, 2026
  const toDate = '20260618';    // Same day

  const xml = `<ENVELOPE>
  <HEADER>
   <VERSION>1</VERSION>
   <TALLYREQUEST>Export</TALLYREQUEST>
   <TYPE>Collection</TYPE>
   <ID>DayBook</ID>
  </HEADER>
  <BODY>
   <DESC>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
     <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
     <SVFROMDATE>${fromDate}</SVFROMDATE>
     <SVTODATE>${toDate}</SVTODATE>
    </STATICVARIABLES>
    <TDL>
      <TDLMESSAGE>
        <COLLECTION NAME="DayBook">
          <TYPE>Voucher</TYPE>
          <FETCH>*</FETCH>
        </COLLECTION>
      </TDLMESSAGE>
    </TDL>
   </DESC>
  </BODY>
</ENVELOPE>`;

  console.log('📝 Sending request to Tally...\n');

  try {
    const response = await axios.post(baseUrl, xml, {
      headers: {
        'Content-Type': 'text/xml',
        'Accept': '*/*'
      },
      timeout: 60000,
      responseType: 'text'
    });

    const responseBody = typeof response.data === 'string' ? response.data : String(response.data);
    console.log(`✅ Received response: ${responseBody.length} bytes\n`);

    // Extract first few VOUCHER elements to see structure
    const voucherMatches = [...responseBody.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
    console.log(`Found ${voucherMatches.length} VOUCHER elements in response\n`);

    if (voucherMatches.length > 0) {
      // Show first voucher structure
      const firstVoucher = voucherMatches[0][0];
      console.log('📄 FIRST VOUCHER STRUCTURE (first 2000 chars):\n');
      console.log(firstVoucher.substring(0, 2000));
      console.log('\n...\n');

      // Extract fields from first few vouchers
      console.log('📊 FIELD ANALYSIS FROM FIRST 5 VOUCHERS:\n');
      
      for (let i = 0; i < Math.min(5, voucherMatches.length); i++) {
        const block = voucherMatches[i][1];
        
        // Extract key fields
        const vtype = block.match(/<VOUCHERTYPENAME>(.*?)<\/VOUCHERTYPENAME>/i)?.[1] || 'N/A';
        const vno = block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1] || 'N/A';
        const amount = block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1] || 'N/A';
        const party = block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1] || 'N/A';
        
        const hasLedgerEntries = block.includes('ALLLEDGERENTRIES.LIST') ? 'YES' : 'NO';
        const hasInventory = block.includes('INVENTORYENTRIES.LIST') ? 'YES' : 'NO';
        
        console.log(`Voucher ${i + 1}:`);
        console.log(`  Type: ${vtype}`);
        console.log(`  Number: ${vno}`);
        console.log(`  Amount: ${amount}`);
        console.log(`  Party: ${party}`);
        console.log(`  Has Ledger Entries: ${hasLedgerEntries}`);
        console.log(`  Has Inventory: ${hasInventory}`);
        console.log();
      }

      // Check if AMOUNT field exists
      const hasAmount = responseBody.includes('<AMOUNT>');
      const hasLedgerEntries = responseBody.includes('<ALLLEDGERENTRIES.LIST>');
      
      console.log('🔎 FIELD PRESENCE CHECK:\n');
      console.log(`AMOUNT field present: ${hasAmount ? '✅ YES' : '❌ NO'}`);
      console.log(`ALLLEDGERENTRIES.LIST present: ${hasLedgerEntries ? '✅ YES' : '❌ NO'}`);
      console.log();

      // Save full response to file for further analysis
      const fs = await import('fs').then(m => m.promises);
      const filePath = './tally-xml-response.xml';
      await fs.writeFile(filePath, responseBody);
      console.log(`💾 Full response saved to: ${filePath}\n`);
      console.log(`📌 Size: ${responseBody.length} bytes\n`);
    } else {
      console.log('⚠️  No VOUCHER elements found in response!');
      console.log(`Response preview: ${responseBody.substring(0, 500)}`);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.response) {
      console.error('Response:', String(err.response.data || '').substring(0, 500));
    }
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
