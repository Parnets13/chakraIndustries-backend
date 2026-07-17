import mongoose from 'mongoose';
import connectDB from '../config/database.js';
import Invoice from '../models/Invoice.js';

async function main() {
  await connectDB();
  
  // Create a new test invoice to force a fresh export
  const newInvoice = new Invoice({
    invoiceNo: `TEST-FIX-${Date.now()}`,
    date: new Date(),
    partyName: 'Test Party for GST Ledger Fix',
    partyGST: '29AAECB5878L1ZY',
    partyState: 'Karnataka',
    gstType: 'Registered',
    source: 'ERP',
    
    items: [{
      description: 'HYDRA STEEL WATER BOTTLE 1000ML',
      hsn: '732393',
      quantity: 1,
      rate: 190.48,
      cgst: 4.76,
      sgst: 4.76,
      igst: 0,
      amount: 200
    }],
    
    subTotal: 190.48,
    cgstTotal: 4.76,
    sgstTotal: 4.76,
    igstTotal: 0,
    totalTax: 9.52,
    discount: 0,
    freight: 0,
    grandTotal: 200,
    
    tallySync: false,
    status: 'Active'
  });

  await newInvoice.save();
  console.log('✅ Created test invoice:', newInvoice.invoiceNo);
  console.log('   Total: ₹200 (Base ₹190.48 + CGST ₹4.76 + SGST ₹4.76)');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
