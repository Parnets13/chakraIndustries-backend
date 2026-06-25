import 'dotenv/config.js';
import mongoose from 'mongoose';
import { importFromFiles } from '../services/tallyFileService.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chakra-industries';

async function testImport() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB!');
    
    console.log('Testing import from files...');
    const result = await importFromFiles();
    
    console.log('Import Result:', result);
    
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await mongoose.connection.close();
  }
}

testImport();
