
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Import tallyFetchEngine
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import connectDB from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';

async function runTest1() {
  // Connect to MongoDB
  await connectDB();

  // Read Test 1 XML
  const test1XmlPath = path.join(__dirname, '..', 'logs', 'tally-xml-requests', 'test-1-2026-07-12T17-22-56-146Z.xml');
  const test1Xml = fs.readFileSync(test1XmlPath, 'utf8');

  // Get real Tally config from database
  const cfg = await TallyConfig.findOne({}).sort({ _id: 1 });

  console.log('Test 1: Got config:', {
    useConnector: cfg.useConnector,
    connectorId: cfg.connectorId,
    tallyLocalUrl: cfg.tallyLocalUrl,
    companyName: cfg.companyName
  });
  console.log('Test 1: Sending to Tally...');
  console.log('Test 1: XML length:', test1Xml.length);

  // Post XML and log raw response
  const rawResponse = await postXmlWithRetry(cfg, test1Xml, 30000, 1);
  console.log('\n\nTest 1: Raw <RESPONSE> from Tally (exact):');
  console.log('=======================================');
  console.log(rawResponse);
  console.log('=======================================');
}

runTest1().catch(console.error);
