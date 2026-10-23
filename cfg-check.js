// cfg-check.js — READ ONLY. Shows the TallyConfig connector flags that decide
// whether the live ledger-HSN fetch runs (it is skipped in connector-ONLINE mode).
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import TallyConfig from './models/TallyConfig.js';

async function main() {
  await connectDB();
  const c = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();
  if (!c) { console.log('No TallyConfig'); process.exit(0); }
  console.log('companyName   :', c.companyName);
  console.log('useConnector  :', c.useConnector);
  console.log('connectorId   :', c.connectorId);
  console.log('connectorOnline (stored):', c.connectorOnline);
  console.log('tallyLocalUrl :', c.tallyLocalUrl || '(none)');
  console.log('\n→ isConnectorOnlineMode = useConnector && connectorId && connectorOnline');
  console.log('→ If TRUE, the live sales-ledger (and its HSN) fetch is SKIPPED, so ledgerHsnMap stays empty.');
  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
