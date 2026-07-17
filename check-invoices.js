import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

async function check() {
  try {
    // Try to connect with timeout
    await Promise.race([
      mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/chakra-erp', { serverSelectionTimeoutMS: 5000 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 6000))
    ]);
    
    const count = await Invoice.countDocuments({ status: { $nin: ['Cancelled'] }, tallySync: { $ne: true } });
    console.log('Invoices pending export:', count);
    
    const synced = await Invoice.countDocuments({ tallySync: true });
    console.log('Invoices already synced:', synced);
    
    const recent = await Invoice.find({ status: { $nin: ['Cancelled'] } }).sort({ createdAt: -1 }).limit(5).lean();
    console.log('\nRecent 5 invoices:');
    recent.forEach(inv => {
      console.log(`  - ${inv.invoiceNo} (tallySync: ${inv.tallySync}, status: ${inv.status}, date: ${inv.invoiceDate?.substring(0,10)})`);
    });
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}
check();
