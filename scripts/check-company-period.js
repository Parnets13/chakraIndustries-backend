import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import TallyConfig from '../models/TallyConfig.js';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}).lean();
console.log('Config company:', cfg?.companyName);
console.log('Config periodEnd:', cfg?.tallyPeriodEnd);

// Query 1: Get company StartingFrom and EndingAt
const xml1 = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CompInfo</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>
    <SVCURRENTCOMPANY>SRI CHAKRA INDUSTRIES</SVCURRENTCOMPANY>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="CompInfo"><TYPE>Company</TYPE><FETCH>Name, StartingFrom, EndingAt</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

try {
  const resp1 = await postXmlWithRetry(cfg, xml1, 30000, 1);
  console.log('\n=== Company Period Response ===');
  console.log(resp1.substring(0, 3000));
} catch (e) {
  console.error('Query 1 failed:', e.message);
}

// Query 2: Try to send a minimal test voucher with TODAY's date
const today = new Date();
const todayStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
console.log('\nToday:', todayStr);

// Try a simple ping to see what date range Tally reports
const pingXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>Day Book</REPORTNAME>
  <STATICVARIABLES>
    <SVCURRENTCOMPANY>SRI CHAKRA INDUSTRIES</SVCURRENTCOMPANY>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
</REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

try {
  const pingResp = await postXmlWithRetry(cfg, pingXml, 30000, 1);
  const fromM = pingResp.match(/<SVFROMDATE[^>]*>(\d{8})<\/SVFROMDATE>/i);
  const toM = pingResp.match(/<SVTODATE[^>]*>(\d{8})<\/SVTODATE>/i);
  const startM = pingResp.match(/<STARTINGFROM[^>]*>(\d{8})<\/STARTINGFROM>/i);
  const endM = pingResp.match(/<ENDINGAT[^>]*>(\d{8})<\/ENDINGAT>/i);
  console.log('\n=== Day Book Ping ===');
  console.log('SVFROMDATE:', fromM?.[1] || 'not found');
  console.log('SVTODATE:', toM?.[1] || 'not found');
  console.log('STARTINGFROM:', startM?.[1] || 'not found');
  console.log('ENDINGAT:', endM?.[1] || 'not found');
  if (pingResp.length < 500) console.log('Full response:', pingResp);
} catch (e) {
  console.error('Ping failed:', e.message);
}

await mongoose.disconnect();
