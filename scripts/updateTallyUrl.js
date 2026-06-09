import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';

dotenv.config();

const NEW_URL     = process.argv[2] || 'https://erp.majesticmall.net';
const COMPANY     = 'SRI CHAKRA INDUSTRIES';

async function run() {
  await connectDB();
  await new Promise(r => setTimeout(r, 2000));
  const r = await TallyConfig.findOneAndUpdate(
    {},
    { $set: {
        tallyLocalUrl: NEW_URL,
        companyName: COMPANY,
        connectionStatus: 'Unknown'
    }},
    { upsert: true, new: true }
  );
  console.log('✅ tallyLocalUrl  :', r.tallyLocalUrl);
  console.log('✅ companyName    :', r.companyName);
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
