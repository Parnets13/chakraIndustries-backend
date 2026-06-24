import dotenv from 'dotenv';
import connectDB from './config/database.js';
import TallyConfig from './models/TallyConfig.js';
import ItemMaster from './models/ItemMaster.js';
import Vendor from './models/Vendor.js';
import Client from './models/Client.js';
import AccountsLedger from './models/AccountsLedger.js';
import TallySyncLog from './models/TallySyncLog.js';

dotenv.config();

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('   CHECKING TALLY IMPORTS IN DATABASE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await connectDB();

  // 1. Check Tally Configuration
  console.log('📋 TALLY CONFIGURATION:');
  const config = await TallyConfig.findOne();
  if (config) {
    console.log(`   ✓ Tally URL           : ${config.tallyLocalUrl || config.serverUrl || 'Not configured'}`);
    console.log(`   ✓ Company Name        : ${config.companyName || 'Not set'}`);
    console.log(`   ✓ Connection Status   : ${config.connectionStatus || 'Unknown'}`);
    console.log(`   ✓ Last Sync           : ${config.lastSyncAt ? new Date(config.lastSyncAt).toLocaleString() : 'Never'}`);
    console.log(`   ✓ Sync Direction      : ${config.syncDirection || 'Bi-directional'}`);
  } else {
    console.log('   ❌ No Tally configuration found!');
  }

  // 2. Check Stock Items with Tally Sync
  console.log('\n📦 STOCK ITEMS (tallySynced=true):');
  const itemsTallySynced = await ItemMaster.countDocuments({ tallySynced: true });
  const itemsTotal = await ItemMaster.countDocuments({});
  console.log(`   Total in ItemMaster  : ${itemsTotal}`);
  console.log(`   Synced from Tally    : ${itemsTallySynced}`);
  
  if (itemsTallySynced > 0) {
    console.log('\n   Items from Tally:');
    const items = await ItemMaster.find({ tallySynced: true }).limit(20).lean();
    items.forEach((item, i) => {
      console.log(`   ${i+1}. ${item.name.padEnd(40)} [HSN: ${item.hsn || 'N/A'}, GST: ${item.gst || 0}%, Unit: ${item.unit || 'N/A'}]`);
      if (item.tallyGuid) console.log(`      └─ Tally GUID: ${item.tallyGuid}`);
    });
    if (itemsTallySynced > 20) {
      console.log(`   ... and ${itemsTallySynced - 20} more items`);
    }
  }

  // 3. Check Vendors with Tally Sync
  console.log('\n🏢 VENDORS (tallySynced=true):');
  const vendorsTallySynced = await Vendor.countDocuments({ tallySynced: true });
  console.log(`   Total Vendors with Tally sync: ${vendorsTallySynced}`);
  if (vendorsTallySynced > 0) {
    const vendors = await Vendor.find({ tallySynced: true }).limit(10).lean();
    vendors.forEach((v, i) => {
      console.log(`   ${i+1}. ${v.companyName} [${v.email || 'no-email'}]`);
    });
  }

  // 4. Check Clients with Tally Sync
  console.log('\n👥 CLIENTS (tallySynced=true):');
  const clientsTallySynced = await Client.countDocuments({ tallySynced: true });
  console.log(`   Total Clients with Tally sync: ${clientsTallySynced}`);
  if (clientsTallySynced > 0) {
    const clients = await Client.find({ tallySynced: true }).limit(10).lean();
    clients.forEach((c, i) => {
      console.log(`   ${i+1}. ${c.name} [${c.email || 'no-email'}]`);
    });
  }

  // 5. Check Ledgers with Tally Sync
  console.log('\n📊 ACCOUNT LEDGERS (syncedWithTally=true):');
  const ledgersTallySynced = await AccountsLedger.countDocuments({ syncedWithTally: true });
  console.log(`   Total Ledgers with Tally sync: ${ledgersTallySynced}`);
  if (ledgersTallySynced > 0) {
    const ledgers = await AccountsLedger.find({ syncedWithTally: true }).limit(10).lean();
    ledgers.forEach((l, i) => {
      console.log(`   ${i+1}. ${l.ledgerName} [${l.ledgerGroup || 'N/A'}]`);
    });
  }

  // 6. Check Tally Sync Logs
  console.log('\n📝 RECENT TALLY SYNC LOGS:');
  const logs = await TallySyncLog.find().sort({ createdAt: -1 }).limit(10).lean();
  if (logs.length > 0) {
    logs.forEach((log, i) => {
      const direction = log.direction || 'Unknown';
      const status = log.status || 'Unknown';
      const records = log.records || 0;
      const date = new Date(log.createdAt).toLocaleString();
      console.log(`   ${i+1}. [${status}] ${direction} - ${log.type || 'Full'} (${records} records) - ${date}`);
      if (log.error) console.log(`      Error: ${log.error}`);
    });
  } else {
    console.log('   ❌ No sync logs found');
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
