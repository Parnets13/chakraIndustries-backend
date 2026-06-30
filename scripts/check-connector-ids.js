import dotenv from 'dotenv';
dotenv.config();
import dns from 'dns';
import mongoose from 'mongoose';

// Fix DNS for MongoDB SRV lookup (same as database.js)
dns.setServers(['8.8.8.8', '8.8.4.4']);

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

const TallyConfig = (await import('../models/TallyConfig.js')).default;
const ConnectorReg = (await import('../models/ConnectorRegistration.js')).default;

const configs = await TallyConfig.find({}).sort({ _id: 1 }).lean();
const regs = await ConnectorReg.find({}).lean();

console.log('\n=== TallyConfig documents (' + configs.length + ') ===');
configs.forEach((c, i) => {
  console.log(`[${i}] _id=${c._id}`);
  console.log(`     connectorId      = "${c.connectorId}"`);
  console.log(`     useConnector     = ${c.useConnector}`);
  console.log(`     secret_length    = ${c.connectorSecret?.length || 0}`);
  console.log(`     connectionStatus = ${c.connectionStatus}`);
  console.log(`     tallyLocalUrl    = "${c.tallyLocalUrl}"`);
});

console.log('\n=== ConnectorRegistration documents (' + regs.length + ') ===');
regs.forEach((r, i) => {
  console.log(`[${i}] connectorId = "${r.connectorId}"`);
  console.log(`     machineId   = "${r.machineId}"`);
  console.log(`     lastSeen    = ${r.lastSeenAt}`);
});

console.log('\n=== ID MATCH CHECK ===');
for (const cfg of configs) {
  if (!cfg.connectorId) { console.log('TallyConfig has NO connectorId'); continue; }
  const match = regs.find(r => r.connectorId === cfg.connectorId);
  if (match) {
    console.log(`MATCH FOUND: TallyConfig connectorId "${cfg.connectorId}" matches machine "${match.machineId}"`);
  } else {
    console.log(`NO MATCH: TallyConfig connectorId "${cfg.connectorId}" has no ConnectorRegistration`);
    if (regs.length > 0) {
      console.log(`  Registered IDs: ${regs.map(r => '"' + r.connectorId + '"').join(', ')}`);
    }
  }
}

await mongoose.disconnect();
process.exit(0);
