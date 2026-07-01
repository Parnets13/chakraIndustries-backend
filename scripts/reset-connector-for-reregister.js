/**
 * reset-connector-for-reregister.js
 *
 * Clears the connectorSecret in TallyConfig so the next time the connector
 * app calls /api/connector/register, a fresh secret is generated and saved
 * to BOTH MongoDB and the connector's config.json — making them match.
 *
 * Run: node scripts/reset-connector-for-reregister.js
 * Then: restart the connector app on the client PC.
 */
import dotenv from 'dotenv';
dotenv.config();
import dns from 'dns';
import mongoose from 'mongoose';

dns.setServers(['8.8.8.8', '8.8.4.4']);
await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

const TallyConfig    = (await import('../models/TallyConfig.js')).default;
const ConnectorReg   = (await import('../models/ConnectorRegistration.js')).default;

// Clear the connectorSecret from TallyConfig — forces new generation on next register
await TallyConfig.findOneAndUpdate(
  {},
  { $set: { connectorSecret: '', connectionStatus: 'Disconnected' } },
  { sort: { _id: 1 } }
);

// Clear the JWT token from ConnectorRegistration so verify fails and connector re-registers
// (token is in the connector's config.json, not in MongoDB — so we just confirm the reg exists)
const reg = await ConnectorReg.findOne({}).lean();
console.log('\nConnectorRegistration still valid:');
console.log(`  connectorId = "${reg?.connectorId}"`);
console.log(`  machineId   = "${reg?.machineId}"`);

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();
console.log('\nTallyConfig after reset:');
console.log(`  connectorId     = "${cfg.connectorId}"`);
console.log(`  connectorSecret = "${cfg.connectorSecret}" (should be empty now)`);
console.log(`  useConnector    = ${cfg.useConnector}`);

console.log(`
=== NEXT STEPS ===
1. On the client PC — open Task Manager, find "SriChakra Connector" and close it.
2. Delete this file: C:\\Users\\<username>\\AppData\\Roaming\\srichakra-connector\\config.json
3. Restart the connector app.
4. It will register fresh, get a new secret, and save it to both MongoDB and config.json.
5. Socket.IO will connect successfully.
`);

await mongoose.disconnect();
process.exit(0);
