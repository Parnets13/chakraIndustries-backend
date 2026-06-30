import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import TallyConfig from '../models/TallyConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  console.log('Connecting to DB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected!');

  const configData = {
    tallyLocalUrl: 'http://localhost',
    port: '9000',
    companyName: 'SRI CHAKRA INDUSTRIES',
    connectionStatus: 'Connected'
  };

  const config = await TallyConfig.findOneAndUpdate({}, configData, { upsert: true, new: true });
  console.log('✅ Tally Config updated:', config);
  console.log('Tally Local URL:', config.tallyLocalUrl);
  console.log('Port:', config.port);
  console.log('Company Name:', config.companyName);

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
