
import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';
import axios from 'axios';

dotenv.config();

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tallyBaseUrl(cfg) {
  const local = (cfg.tallyLocalUrl || '').trim();
  const port = cfg.port || '9000';
  if (!local) return `http://localhost:${port}`;
  if (local.startsWith('https://')) return local.replace(/\/$/, '');
  if (local.match(/:\d+$/)) return local.replace(/\/$/, '');
  return `${local.replace(/\/$/, '')}:${port}`;
}

async function testTallyRequest(url, xml, description) {
  console.log(`\n=== Testing ${description} ==`);
  console.log(`URL: ${url}`);
  console.log('Request XML:');
  console.log(xml);
  
  try {
    const resp = await axios.post(url, xml, {
      headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
      timeout: 60000
    });
    
    console.log(`\n✅ Success! Status: ${resp.status}`);
    console.log(`Response length: ${resp.data.length} bytes`);
    console.log('\nResponse preview (first 3000 chars):');
    console.log(resp.data.slice(0, 3000));
    
    // Check for important tags
    const tags = ['STOCKITEM', 'LEDGER', 'GROUP', 'STOCKGROUP', 'UNIT', 'GODOWN', 'CURRENCY', 'ENVELOPE', 'ERROR'];
    console.log('\nTag counts:');
    tags.forEach(tag => {
      const count = (resp.data.match(new RegExp(`<${tag}`, 'gi')) || []).length;
      console.log(`  <${tag}>: ${count}`);
    });
    
    return resp.data;
  } catch (err) {
    console.error('\n❌ Error:');
    console.error(`  Message: ${err.message}`);
    if (err.code) console.error(`  Code: ${err.code}`);
    if (err.response) {
      console.error(`  Status: ${err.response.status}`);
      console.error(`  Response data: ${err.response.data}`);
    }
    return null;
  }
}

async function main() {
  await connectDB();
  
  console.log('🔍 Checking TallyConfig from database...');
  const cfg = await TallyConfig.findOne();
  console.log('TallyConfig:', JSON.stringify(cfg, null, 2));
  
  const url = tallyBaseUrl(cfg);
  const company = (cfg.companyName || '').trim();
  
  // Test 1: List of Companies (ping)
  const pingXml = `<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY><EXPORTDATA><REQUESTDESC>
      <REPORTNAME>List of Companies</REPORTNAME>
      <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
    </REQUESTDESC></EXPORTDATA></BODY>
  </ENVELOPE>`;
  await testTallyRequest(url, pingXml, 'List of Companies');
  
  // Test 2: List of Accounts with company
  const listOfAccountsXml = `<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY><EXPORTDATA><REQUESTDESC>
      <REPORTNAME>List of Accounts</REPORTNAME>
      <STATICVARIABLES>
        ${company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : ''}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </REQUESTDESC></EXPORTDATA></BODY>
  </ENVELOPE>`;
  await testTallyRequest(url, listOfAccountsXml, 'List of Accounts');
  
  // Test 3: All Masters with company
  const allMastersXml = `<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY><EXPORTDATA><REQUESTDESC>
      <REPORTNAME>All Masters</REPORTNAME>
      <STATICVARIABLES>
        ${company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : ''}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </REQUESTDESC></EXPORTDATA></BODY>
  </ENVELOPE>`;
  await testTallyRequest(url, allMastersXml, 'All Masters');
  
  // Test 4: Custom TDL Stock Items
  const tdlXml = `<ENVELOPE>
    <HEADER>
      <VERSION>1</VERSION>
      <TALLYREQUEST>Export</TALLYREQUEST>
      <TYPE>Data</TYPE>
      <ID>StockItemList</ID>
    </HEADER>
    <BODY>
      <DESC>
        <STATICVARIABLES>
          ${company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : ''}
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
        <TDL>
          <TDLMESSAGE>
            <REPORT NAME="StockItemList">
              <FORMS>StockItemForm</FORMS>
            </REPORT>
            <FORM NAME="StockItemForm">
              <TOPPARTS>StockItemPart</TOPPARTS>
            </FORM>
            <PART NAME="StockItemPart">
              <REPEAT>StockItemLine : StockItems</REPEAT>
            </PART>
            <COLLECTION NAME="StockItems">
              <TYPE>StockItem</TYPE>
            </COLLECTION>
          </TDLMESSAGE>
        </TDL>
      </DESC>
    </BODY>
  </ENVELOPE>`;
  await testTallyRequest(url, tdlXml, 'Custom TDL Stock Items');
  
  console.log('\n✅ Debug script completed!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
