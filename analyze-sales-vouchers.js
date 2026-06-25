import dotenv from 'dotenv';
import connectDB from './config/database.js';
import TallyVoucher from './models/TallyVoucher.js';

dotenv.config();

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║       SALES VOUCHER DETAILED ANALYSIS                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  await connectDB();

  // Get first Sales voucher with amount > 0
  console.log('🔍 Finding Sales vouchers with Amount > 0...\n');
  
  const withAmount = await TallyVoucher.find({
    voucherType: 'Sales',
    amount: { $gt: 0 }
  }).limit(5).lean();

  if (withAmount.length > 0) {
    console.log(`✅ Found ${withAmount.length} Sales vouchers with amount > 0\n`);
    withAmount.forEach((v, i) => {
      console.log(`${i + 1}. ${v.voucherNumber} (${new Date(v.voucherDate).toLocaleDateString('en-IN')})`);
      console.log(`   Amount: ${v.amount}`);
      console.log(`   Party: ${v.partyName}`);
      console.log(`   Ledger Entries: ${v.ledgerEntries?.length || 0}`);
      console.log(`   Inventory Entries: ${v.inventoryEntries?.length || 0}`);
      console.log();
    });
  } else {
    console.log('❌ NO Sales vouchers with Amount > 0 found!\n');
  }

  // Check all and count by amount > 0
  console.log('📊 Amount Statistics:\n');
  
  const allSales = await TallyVoucher.find({ voucherType: 'Sales' }).lean();
  const withAmountCount = allSales.filter(v => v.amount > 0).length;
  const zeroAmountCount = allSales.filter(v => v.amount === 0).length;
  const nullAmountCount = allSales.filter(v => !v.amount).length;

  console.log(`Total Sales vouchers: ${allSales.length}`);
  console.log(`  With Amount > 0: ${withAmountCount}`);
  console.log(`  With Amount = 0: ${zeroAmountCount}`);
  console.log(`  With null Amount: ${nullAmountCount}`);
  console.log();

  // Check one voucher with Amount = 0 in detail
  console.log('🔎 Detailed inspection of Amount = 0 voucher:\n');
  
  const zeroVoucher = allSales.find(v => v.amount === 0);
  if (zeroVoucher) {
    console.log(`Voucher: ${zeroVoucher.voucherNumber}`);
    console.log(`Date: ${new Date(zeroVoucher.voucherDate).toLocaleDateString('en-IN')}`);
    console.log(`Party: ${zeroVoucher.partyName}`);
    console.log(`Amount: ${zeroVoucher.amount}`);
    console.log(`Narration: ${zeroVoucher.narration}`);
    console.log(`\nLedger Entries (${zeroVoucher.ledgerEntries?.length || 0}):`);
    if (zeroVoucher.ledgerEntries?.length) {
      zeroVoucher.ledgerEntries.forEach(le => {
        console.log(`  - ${le.ledgerName}: ${le.amount}`);
      });
    }
    console.log(`\nInventory Entries (${zeroVoucher.inventoryEntries?.length || 0}):`);
    if (zeroVoucher.inventoryEntries?.length) {
      zeroVoucher.inventoryEntries.forEach(ie => {
        console.log(`  - ${ie.stockItemName}: Qty=${ie.qty}, Rate=${ie.rate}, Amount=${ie.amount}`);
      });
    }
    console.log(`\nFull Data:`);
    console.log(JSON.stringify(zeroVoucher, null, 2).substring(0, 1000));
  }

  // Check Invoice collection to see if Tally invoices exist at all
  console.log('\n💼 CHECKING INVOICE COLLECTION:\n');
  const { default: Invoice } = await import('./models/Invoice.js');
  
  const tallyInvoices = await Invoice.countDocuments({ source: 'Tally' });
  console.log(`Invoices with source='Tally': ${tallyInvoices}`);

  const allInvoices = await Invoice.countDocuments({});
  console.log(`Total Invoices in collection: ${allInvoices}`);

  // Look for any invoice with partyName matching our Sales parties
  if (zeroVoucher && zeroVoucher.partyName) {
    const matchingInvoices = await Invoice.find({
      partyName: new RegExp(zeroVoucher.partyName.split(' ')[0], 'i')
    }).limit(3).lean();
    
    console.log(`\nInvoices matching party "${zeroVoucher.partyName.split(' ')[0]}":`);
    if (matchingInvoices.length > 0) {
      matchingInvoices.forEach(inv => {
        console.log(`  - ${inv.invoiceNo} (${inv.source}): ${inv.partyName}`);
      });
    } else {
      console.log('  None found');
    }
  }

  // Check if tallyGuid field exists in some vouchers
  console.log('\n\n🔗 CHECKING TALLY GUID LINKING:\n');
  
  const vouchersWithGuid = await TallyVoucher.countDocuments({
    voucherType: 'Sales',
    tallyGuid: { $exists: true, $ne: null }
  });
  
  const vouchersWithoutGuid = allSales.length - vouchersWithGuid;
  
  console.log(`Sales vouchers with tallyGuid: ${vouchersWithGuid}`);
  console.log(`Sales vouchers without tallyGuid: ${vouchersWithoutGuid}`);

  if (vouchersWithoutGuid > 0) {
    console.log('\n⚠️  Vouchers without GUID cannot be mirrored to Invoice!');
  }

  console.log('\n═'.repeat(65) + '\n');
  process.exit(0);
}

main().catch(e => {
  console.error('Analysis failed:', e.message);
  process.exit(1);
});
