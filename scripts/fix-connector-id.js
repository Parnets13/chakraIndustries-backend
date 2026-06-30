/**
 * fix-connector-id.js
 * 
 * Copies the connectorId + connectorSecret from the actual ConnectorRegistration
 * into TallyConfig so Socket.IO auth succeeds.
 * 
 * Run once: node scripts/fix-connector-id.js
 */
import dotenv from 'dotenv';
dotenv.config();
import dns from 'dns';
import mongoose from 'mongoose';

dns.setServers(['8.8.8.8', '8.8.4.4']);

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

const TallyConfig = (await import('../models/TallyConfig.js')).default;
const ConnectorReg = (await import('../models/ConnectorRegistration.js')).default;

// Get the real registered connector
const reg = await ConnectorReg.findOne({}).sort({ createdAt: -1 }).lean();
if (!reg) {
  console.error('No ConnectorRegistration found. Make sure the connector app has been opened at least once.');
  process.exit(1);
}

console.log(`Found ConnectorRegistration:`);
console.log(`  connectorId = "${reg.connectorId}"`);
console.log(`  machineId   = "${reg.machineId}"`);

// Get TallyConfig
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
if (!cfg) {
  console.error('No TallyConfig found.');
  process.exit(1);
}

console.log(`\nCurrent TallyConfig:`);
console.log(`  connectorId = "${cfg.connectorId}"`);
console.log(`  useConnector = ${cfg.useConnector}`);

if (cfg.connectorId === reg.connectorId) {
  console.log('\nIDs already match — nothing to fix.');
  await mongoose.disconnect();
  process.exit(0);
}

// The connectorSecret in TallyConfig was set when the connector registered.
// We keep the existing secret — the connector saved it to config.json at that time.
console.log(`\nFixing: updating TallyConfig.connectorId from "${cfg.connectorId}" to "${reg.connectorId}"`);

await TallyConfig.findOneAndUpdate(
  {},
  {
    connectorId:  reg.connectorId,
    useConnector: true,
    connectionStatus: 'Disconnected',
    // Keep existing connectorSecret — connector already has it in config.json
  },
  { sort: { _id: 1 } }
);

const verify = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();
console.log(`\nTallyConfig after fix:`);
console.log(`  connectorId      = "${verify.connectorId}"`);
console.log(`  useConnector     = ${verify.useConnector}`);
console.log(`  secret_length    = ${verify.connectorSecret?.length || 0}`);
console.log(`  connectionStatus = ${verify.connectionStatus}`);
console.log('\nDone. Restart the backend and reconnect the connector.');

await mongoose.disconnect();
process.exit(0);
