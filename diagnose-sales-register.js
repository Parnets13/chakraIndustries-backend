import dotenv from 'dotenv';
import connectDB from './config/database.js';
import TallySyncLog from './models/TallySyncLog.js';
import TallyVoucher from './models/TallyVoucher.js';
import Invoice from './models/Invoice.js';

dotenv.config();

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║          SALES REGISTER IMPORT DIAGNOSTIC REPORT               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  await connectDB();

  // ═════════════════════════════════════════════════════════════════════════
  // 1. CHECK RECENT SYNC LOGS FOR SALES IMPORTS
  // ═════════════════════════════════════════════════════════════════════════
  console.log('📋 RECENT SALES IMPORT LOGS:\n');
  const syncLogs = await TallySyncLog.find({ type: 'Sales' })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  if (syncLogs.length === 0) {
    console.log('❌ No Sales import logs found!\n');
  } else {
    syncLogs.forEach((log, i) => {
      const date = new Date(log.createdAt).toLocaleString('en-IN');
      console.log(`${i + 1}. [${log.status}] ${date}`);
      console.log(`   Records: ${log.records}`);
      console.log(`   Duration: ${log.duration}`);
      if (log.error) console.log(`   Error: ${log.error}`);
      if (log.modules?.length) {
        log.modules.forEach(m => {
          console.log(`   → ${m.name}: ${m.count} records (${m.created} new, ${m.updated} updated)`);
        });
      }
      console.log();
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 2. COUNT SALES VOUCHERS IN DATABASE
  // ═════════════════════════════════════════════════════════════════════════
  console.log('📊 SALES VOUCHERS IN DATABASE:\n');
  
  const salesVoucherCount = await TallyVoucher.countDocuments({ voucherType: 'Sales' });
  console.log(`Total Sales vouchers in TallyVoucher: ${salesVoucherCount}`);
  
  if (salesVoucherCount > 0) {
    // Show sample
    const samples = await TallyVoucher.find({ voucherType: 'Sales' })
      .sort({ voucherDate: -1 })
      .limit(5)
      .lean();
    
    console.log('\nSample Sales Vouchers:');
    samples.forEach(s => {
      const date = new Date(s.voucherDate).toLocaleDateString('en-IN');
      console.log(`  • ${s.voucherNumber} (${date}) - Party: ${s.partyName} - Amount: ${s.amount}`);
    });

    // Date range analysis
    console.log('\nDate Range Analysis:');
    const oldestSales = await TallyVoucher.findOne({ voucherType: 'Sales' })
      .sort({ voucherDate: 1 })
      .lean();
    const newestSales = await TallyVoucher.findOne({ voucherType: 'Sales' })
      .sort({ voucherDate: -1 })
      .lean();
    
    if (oldestSales) console.log(`  Oldest: ${new Date(oldestSales.voucherDate).toLocaleDateString('en-IN')}`);
    if (newestSales) console.log(`  Newest: ${new Date(newestSales.voucherDate).toLocaleDateString('en-IN')}`);

    // Check for April, May, June data
    const aprilStart = new Date(2025, 3, 1); // April 1
    const juneEnd = new Date(2025, 5, 30);   // June 30
    const aprilMayJuneCount = await TallyVoucher.countDocuments({
      voucherType: 'Sales',
      voucherDate: { $gte: aprilStart, $lte: juneEnd }
    });
    console.log(`  Sales in April-June 2025: ${aprilMayJuneCount}`);
  } else {
    console.log('❌ NO Sales vouchers found in TallyVoucher!\n');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 3. CHECK INVOICES WITH TALLY SOURCE
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n💼 INVOICES WITH TALLY SOURCE:\n');
  
  const tallyInvoiceCount = await Invoice.countDocuments({ source: 'Tally' });
  console.log(`Total Invoices from Tally: ${tallyInvoiceCount}`);
  
  if (tallyInvoiceCount > 0) {
    const samples = await Invoice.find({ source: 'Tally' })
      .sort({ invoiceDate: -1 })
      .limit(5)
      .lean();
    
    console.log('\nSample Tally Invoices:');
    samples.forEach(inv => {
      const date = new Date(inv.invoiceDate).toLocaleDateString('en-IN');
      console.log(`  • ${inv.invoiceNo} (${date}) - Party: ${inv.partyName} - Total: ${inv.grandTotal}`);
    });
  } else {
    console.log('❌ NO Invoices from Tally found!\n');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 4. CHECK FOR ANY SYNC STATE
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n🔄 SYNC STATE:\n');
  
  const { TallySyncState } = await import('./models/TallySyncState.js');
  const salesState = await TallySyncState.findOne({ entityType: 'Sales' }).lean();
  
  if (salesState) {
    console.log('Sales Sync State:');
    console.log(`  Status: ${salesState.syncStatus}`);
    console.log(`  Last Synced: ${salesState.lastSyncedDate ? new Date(salesState.lastSyncedDate).toLocaleString('en-IN') : 'Never'}`);
    if (salesState.lastError) console.log(`  Last Error: ${salesState.lastError}`);
  } else {
    console.log('No Sales sync state found (first run)');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 5. DIAGNOSIS & RECOMMENDATIONS
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(65));
  console.log('🎯 DIAGNOSIS & RECOMMENDATIONS:\n');

  if (salesVoucherCount === 0 && tallyInvoiceCount === 0) {
    console.log('⚠️  NO DATA FOUND - This means:');
    console.log('  1. Tally XML export returned no Sales vouchers, OR');
    console.log('  2. Voucher type names in Tally don\'t match expected types, OR');
    console.log('  3. Date range filter is excluding all data\n');
    console.log('📝 Next Steps:');
    console.log('  1. Check Tally for "Sales Register" vouchers in April-June');
    console.log('  2. Verify voucher type name in Tally (may be "Tax Invoice", "GST Invoice", etc)');
    console.log('  3. Try full import without date filter to see if any Sales data exists');
    console.log('  4. Check Tally connection logs for XML parse errors');
  } else if (salesVoucherCount > 0) {
    console.log('✅ SALES DATA FOUND IN DATABASE');
    console.log(`   ${salesVoucherCount} Sales vouchers imported successfully\n`);
    console.log('📝 Next Steps:');
    console.log('  1. Check if frontend is querying the API correctly');
    console.log('  2. Verify date range filters in API call');
    console.log('  3. Check UI component for display issues');
  }

  console.log('\n═'.repeat(65) + '\n');
  process.exit(0);
}

main().catch(e => {
  console.error('Diagnostic failed:', e.message);
  process.exit(1);
});
