
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

async function main() {
  console.log('Connecting to MongoDB...');
  console.log('URI:', process.env.MONGO_URI?.replace(/:([^:@]+)@/, ':***@'));
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const cfg = await TallyConfig.findOne();
  console.log('TallyConfig:', cfg ? JSON.stringify(cfg.toObject(), null, 2) : 'Not found');

  await mongoose.disconnect();
  console.log('Disconnected');
}

main().catch(console.error);
