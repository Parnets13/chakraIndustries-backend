
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import TallyConfig from '../models/TallyConfig.js';
import TallySyncState from '../models/TallySyncState.js';
import TallySyncLog from '../models/TallySyncLog.js';

dotenv.config();

async function check() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/chakraindustries');
    
    const config = await TallyConfig.findOne();
    console.log('=== TallyConfig ===');
    console.log(JSON.stringify(config, null, 2));

    console.log('\n=== Recent TallySyncLogs ===');
    const logs = await TallySyncLog.find().sort({ createdAt: -1 }).limit(10);
    console.log(JSON.stringify(logs, null, 2));
    
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

check();
