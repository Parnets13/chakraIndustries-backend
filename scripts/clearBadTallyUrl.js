/**
 * clearBadTallyUrl.js
 * One-time script: clears erp.majesticmall.net from tallyLocalUrl in DB.
 * Run: node scripts/clearBadTallyUrl.js
 */
import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';

dotenv.config();

async function run() {
  await connectDB();
  await new Promise(r => setTimeout(r, 1500));

  const cfg = await TallyConfig.findOne();
  if (!cfg) {
    console.log('No TallyConfig document found in DB.');
    process.exit(0);
  }

  console.log('Current tallyLocalUrl:', cfg.tallyLocalUrl);
  console.log('Current serverUrl    :', cfg.serverUrl);

  const badUrls = ['https://erp.majesticmall.net', 'http://erp.majesticmall.net'];
  const isBad   = badUrls.some(u => (cfg.tallyLocalUrl || '').includes(u));

  if (!isBad) {
    console.log('\n✅ tallyLocalUrl looks fine — no change needed.');
    console.log('   If Tally still cannot connect, set TALLY_LOCAL_URL in .env and run fixTallyConfig.js');
    process.exit(0);
  }

  console.log('\n⚠  tallyLocalUrl is set to the ERP server itself — clearing it.');
  await TallyConfig.findOneAndUpdate(
    {},
    {
      $set: {
        tallyLocalUrl    : '',
        connectionStatus : 'Unknown',
        serverUrl        : 'https://erp.majesticmall.net',
      }
    }
  );

  console.log('\n✅ tallyLocalUrl cleared.');
  console.log('\nNext step — set it to the actual Tally machine URL:');
  console.log('  Option A — Same LAN:     TALLY_LOCAL_URL=http://192.168.1.50');
  console.log('  Option B — Tunnel:       TALLY_LOCAL_URL=https://tally.majesticmall.net');
  console.log('  Option C — Public IP:    TALLY_LOCAL_URL=http://103.x.x.x');
  console.log('\nThen run:  node scripts/fixTallyConfig.js');
  console.log('Or set it in the ERP UI: Tally → Configuration → Tally Local URL\n');
  process.exit(0);
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
