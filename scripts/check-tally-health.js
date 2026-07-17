/**
 * check-tally-health.js
 * Safe Tally health check — uses proven ping XML that does NOT trigger TDL errors.
 * node scripts/check-tally-health.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import TallyConfig from '../models/TallyConfig.js';

await mongoose.connect(process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const url = cfg.tallyLocalUrl || 'http://localhost:9000';
console.log(`Testing Tally at: ${url}`);

// Safe ping — no TDL, just asks Tally to export companies list
const pingXml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>List of Companies</ID>
</HEADER>
<BODY>
  <DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
  </DESC>
</BODY>
</ENVELOPE>`;

try {
  const r = await axios.post(url, pingXml, {
    headers: { 'Content-Type': 'text/xml' },
    timeout: 10000,
  });
  const b = String(r.data || '');
  console.log('✅ Tally is responding  HTTP', r.status, '  bytes:', b.length);
  console.log('Response preview:', b.slice(0, 300));
} catch (e) {
  console.log('❌ Tally not responding:', e.message);
  if (e.code === 'ECONNREFUSED') {
    console.log('→ Tally is not running or HTTP server is disabled');
    console.log('→ Open Tally Prime → F12 → Configure → Advanced Configuration → Enable ODBC/HTTP Server: Yes, Port: 9000');
  } else if (e.code === 'ECONNABORTED' || e.message.includes('timeout')) {
    console.log('→ Tally is running but not responding (may be busy or locked)');
    console.log('→ Restart Tally Prime and try again');
  }
}

await mongoose.disconnect();
