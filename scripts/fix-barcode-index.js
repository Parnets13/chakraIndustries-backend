import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/chakra';

async function fixBarcodeIndex() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected!');

  const db = mongoose.connection.db;
  const collection = db.collection('itemmasters');

  try {
    console.log('\nChecking current indexes...');
    const indexes = await collection.indexes();
    console.log('Found indexes:', indexes.map(i => i.name));

    const barcodeIndex = indexes.find(i => i.name === 'barcode_1');
    if (barcodeIndex) {
      console.log('\nDropping old barcode index...');
      await collection.dropIndex('barcode_1');
      console.log('Old index dropped!');
    } else {
      console.log('\nOld barcode index not found.');
    }

    console.log('\nCreating new sparse barcode index...');
    await collection.createIndex(
      { barcode: 1 },
      { unique: true, sparse: true }
    );
    console.log('New sparse index created!');

    console.log('\nIndex fix complete!');
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

fixBarcodeIndex();
