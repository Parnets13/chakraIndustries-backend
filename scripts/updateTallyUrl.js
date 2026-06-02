/**
 * One-time script to update TallyConfig to use the Cloudflare tunnel URL
 * Run: node scripts/updateTallyUrl.js
 */
import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';

dotenv.config();

async function updateUrl() {
  await connectDB();
  
  console.log('Updating TallyConfig...');
  
  const result = await TallyConfig.findOneAndUpdate(
    {},
    {
      $set: {
        serverUrl: 'https://erp.majesticmall.net',
        port: '9000',
        connectionStatus: 'Unknown'
      }
    },
    { upsert: true, new: true }
  );
  
  console.log('✅ Updated TallyConfig:');
  console.log('   Server URL:', result.serverUrl);
  console.log('   Port:', result.port);
  console.log('   Connection Status:', result.connectionStatus);
  
  process.exit(0);
}

updateUrl().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
