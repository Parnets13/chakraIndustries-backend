/**
 * setTallyUrl.js
 *
 * Run this AFTER you fix the Cloudflare tunnel in the dashboard.
 *
 * Usage:
 *   node scripts/setTallyUrl.js "https://erp.majesticmall.net"
 *
 * Replace the URL argument with whatever public hostname you set up
 * for Tally on the client's machine.
 *
 * If Tally and the backend are on the SAME machine:
 *   node scripts/setTallyUrl.js "http://localhost" 9000
 */
import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';

dotenv.config();

const tallyUrl  = process.argv[2];
const tallyPort = process.argv[3] || '9000';

if (!tallyUrl) {
  console.error('Usage: node scripts/setTallyUrl.js <tally-url> [port]');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/setTallyUrl.js "https://erp.majesticmall.net"');
  console.error('  node scripts/setTallyUrl.js "http://192.168.1.50" 9000');
  console.error('  node scripts/setTallyUrl.js "http://localhost" 9000');
  process.exit(1);
}

async function run() {
  await connectDB();
  await new Promise(r => setTimeout(r, 3000));

  const result = await TallyConfig.findOneAndUpdate(
    {},
    { $set: { tallyLocalUrl: tallyUrl, port: tallyPort, connectionStatus: 'Unknown' } },
    { upsert: true, new: true }
  );

  console.log('');
  console.log('✅ TallyConfig.tallyLocalUrl set to:', result.tallyLocalUrl);
  console.log('   Port:', result.port);
  console.log('');
  console.log('The backend will now reach Tally at:',
    tallyUrl.startsWith('https://') ? tallyUrl : `${tallyUrl}:${tallyPort}`
  );
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart the backend (if running)');
  console.log('  2. Go to ERP → Tally → Configuration → click "Test Connection"');
  console.log('  3. If connected, click "Full Bidirectional Sync"');
  process.exit(0);
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
