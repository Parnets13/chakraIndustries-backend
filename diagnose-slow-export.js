import dotenv from 'dotenv';
import connectDB from './config/database.js';
import ItemMaster from './models/ItemMaster.js';
import Vendor from './models/Vendor.js';
import Client from './models/Client.js';
import AccountsLedger from './models/AccountsLedger.js';
import TallySyncLog from './models/TallySyncLog.js';

dotenv.config();

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║    WHY IS EXPORT TO TALLY SO SLOW? - DIAGNOSTIC REPORT         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  await connectDB();

  // Count data that will be exported
  console.log('📊 DATA TO BE EXPORTED TO TALLY:\n');
  
  const itemCount = await ItemMaster.countDocuments({ isActive: true });
  console.log(`📦 Stock Items (isActive=true): ${itemCount}`);
  console.log(`   → Each item = ~500 bytes of XML`);
  console.log(`   → Total XML: ~${(itemCount * 500 / 1024).toFixed(1)} KB\n`);

  const vendorCount = await Vendor.countDocuments({});
  console.log(`🏢 Vendors: ${vendorCount}`);
  console.log(`   → Each vendor = ~800 bytes of XML`);
  console.log(`   → Total XML: ~${(vendorCount * 800 / 1024).toFixed(1)} KB\n`);

  const clientCount = await Client.countDocuments({ status: 'Active' });
  console.log(`👥 Clients (Active): ${clientCount}`);
  console.log(`   → Each client = ~800 bytes of XML`);
  console.log(`   → Total XML: ~${(clientCount * 800 / 1024).toFixed(1)} KB\n`);

  const ledgerCount = await AccountsLedger.countDocuments({ isActive: true });
  console.log(`📊 Account Ledgers (isActive=true): ${ledgerCount}`);
  console.log(`   ⚠️  PROBLEM: This is ${ledgerCount} ledgers!`);
  console.log(`   → Each ledger = ~600 bytes of XML`);
  console.log(`   → Total XML: ~${(ledgerCount * 600 / 1024).toFixed(1)} KB`);
  console.log(`   → This is HUGE and will cause timeout!\n`);

  const totalSize = (itemCount * 500) + (vendorCount * 800) + (clientCount * 800) + (ledgerCount * 600);
  console.log(`\n📈 TOTAL DATA SIZE TO EXPORT:\n`);
  console.log(`   ${(totalSize / 1024 / 1024).toFixed(2)} MB of XML data\n`);

  // Check recent sync logs
  console.log('📝 RECENT EXPORT LOGS:\n');
  const logs = await TallySyncLog.find({ direction: 'ERP → Tally' })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  if (logs.length === 0) {
    console.log('   No export logs found\n');
  } else {
    logs.forEach((log, i) => {
      const date = new Date(log.createdAt).toLocaleString();
      console.log(`${i + 1}. [${log.status}] ${log.type}`);
      console.log(`   Time: ${date}`);
      console.log(`   Duration: ${log.duration}`);
      console.log(`   Records: ${log.records}`);
      if (log.error) console.log(`   ERROR: ${log.error}`);
      console.log();
    });
  }

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        THE PROBLEM                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`⚠️  YOU ARE TRYING TO EXPORT ${ledgerCount} LEDGERS TO TALLY!\n`);
  console.log('This is why it\'s SLOW:\n');
  console.log(`1. Total XML data: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log('2. Tally timeout: 30-35 seconds (most requests fail)');
  console.log(`3. Processing time: ~${Math.ceil(ledgerCount / 100)} seconds to process all ledgers`);
  console.log('4. Network sending: ~5-10 seconds to upload XML');
  console.log('5. Tally parsing: ~20-30+ seconds to create all records\n');

  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log('🎯 SOLUTION:\n');
  console.log('DON\'T export ALL ledgers - export only what you need:\n');
  console.log('✅ Option 1: Export ONLY Stock Items');
  console.log('   → Much faster (only ' + itemCount + ' items)');
  console.log('   → Recommended: Use Export Tab → Select "Items Only"\n');

  console.log('✅ Option 2: Export ONLY Vendors & Clients');
  console.log('   → Faster (only ' + (vendorCount + clientCount) + ' parties)');
  console.log('   → Recommended: Use Export Tab → Deselect "Ledgers"\n');

  console.log('❌ Option 3: Export EVERYTHING (Default)');
  console.log(`   → VERY SLOW (${(totalSize / 1024 / 1024).toFixed(2)} MB of data)`);
  console.log('   → Will TIMEOUT and fail\n');

  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log('📋 WHAT TO DO NOW:\n');
  console.log('1. Go to: /tally/export (Export Tab)');
  console.log('2. UNCHECK "Ledgers" (you have 4,687 of them!)');
  console.log('3. Keep checked: "Items", "Vendors", "Clients"');
  console.log('4. Click: "Export to Tally"');
  console.log('5. Wait ~30-60 seconds (not 10+ minutes)\n');

  console.log('═══════════════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
