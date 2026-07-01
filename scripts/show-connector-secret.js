/**
 * show-connector-secret.js
 * Prints the connectorSecret stored in TallyConfig (MongoDB)
 * so you can compare it with what the connector app has in config.json
 */
import dotenv from 'dotenv';
dotenv.config();
import dns from 'dns';
import mongoose from 'mongoose';

dns.setServers(['8.8.8.8', '8.8.4.4']);
await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

const TallyConfig = (await import('../models/TallyConfig.js')).default;
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();

console.log('\n=== TallyConfig connector credentials ===');
console.log(`connectorId     = "${cfg.connectorId}"`);
console.log(`connectorSecret = "${cfg.connectorSecret}"`);
console.log(`useConnector    = ${cfg.useConnector}`);
console.log('\nThe connector app config.json is at:');
console.log('  C:\\Users\\<username>\\AppData\\Roaming\\srichakra-connector\\config.json');
console.log('\nThe connectorId and connectorSecret in that file must match the values above.');

await mongoose.disconnect();
process.exit(0);
