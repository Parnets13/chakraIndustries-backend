/**
 * fixTallyConfig.js
 * One-time script to set the correct Tally URL in MongoDB.
 *
 * SETUP:
 *   Tally Prime is on the SAME machine as this server.
 *   The server reaches Tally directly via http://localhost:9000 (no tunnel needed).
 *   The tunnel tally.majesticmall.net also points to port 9000 for external access.
 *
 * TALLY PRIME SETUP (on this machine):
 *   1. Open Tally Prime
 *   2. Press F12 → Configure → Advanced Configuration
 *   3. Enable ODBC/HTTP Server: Yes
 *   4. Port Number: 9000
 *   5. Save and keep Tally open
 *
 * Run: node scripts/fixTallyConfig.js
 */
import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';

dotenv.config();

const TALLY_URL  = (process.env.TALLY_LOCAL_URL || 'http://localhost:9000').trim();
const TALLY_PORT = (process.env.TALLY_PORT || '9000').trim();
const COMPANY    = (process.env.TALLY_COMPANY || 'SRI CHAKRA INDUSTRIES').trim();

async function fix() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('  fixTallyConfig — updating MongoDB TallyConfig');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('  Tally URL  :', TALLY_URL);
  console.log('  Tally Port :', TALLY_PORT);
  console.log('  Company    :', COMPANY);
  console.log('');

  await connectDB();
  await new Promise(r => setTimeout(r, 2000));

  const result = await TallyConfig.findOneAndUpdate(
    {},
    {
      $set: {
        tallyLocalUrl:    TALLY_URL,
        port:             TALLY_PORT,
        companyName:      COMPANY,
        serverUrl:        'https://erp.majesticmall.net',
        connectionStatus: 'Unknown',
        syncDirection:    'Bi-directional',
        autoSync:         true,
        syncInterval:     'Every 15 minutes',
      }
    },
    { upsert: true, new: true }
  );

  console.log('✅ TallyConfig updated in MongoDB:');
  console.log('   tallyLocalUrl :', result.tallyLocalUrl);
  console.log('   port          :', result.port);
  console.log('   company       :', result.companyName);
  console.log('   syncDirection :', result.syncDirection);
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Make sure Tally Prime is open on this machine');
  console.log('  2. In Tally: F12 → Configure → Advanced Configuration');
  console.log('     → Enable ODBC/HTTP Server: Yes  → Port: 9000');
  console.log('  3. Restart the ERP server: npm start  OR  pm2 restart all');
  console.log('  4. In ERP → Tally → click "Test Connection"');
  console.log('');
  process.exit(0);
}

fix().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
