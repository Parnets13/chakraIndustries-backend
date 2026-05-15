import mongoose from 'mongoose';
import dotenv from 'dotenv';
import LossTracking from '../models/LossTracking.js';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const professionalLossData = [
  {
    mrId: 'MR-2026-011',
    supplierName: 'Rajesh Traders Pvt Ltd',
    invoiceNumber: 'INV-2026-5678',
    invoiceDate: new Date('2026-04-15'),
    invoiceType: 'Purchase',
    lossType: 'Transit Damage',
    rootCause: 'Transport Mishandling',
    lossAmount: 25760,
    recoverableAmount: 20000,
    responsibleDepartment: 'Logistics',
    responsiblePerson: 'Amit Kumar',
    priority: 'High',
    slaDueDate: new Date(Date.now() + (72 * 60 * 60 * 1000)), // 3 days from now
    financialStatus: 'Debit Note Raised',
    materialStatus: 'QC Completed',
    reconciliationStatus: 'Material Closed',
    finalStatus: 'In Progress',
    products: [{
      productName: 'Steel Rods 12mm',
      skuCode: 'STL-ROD-12MM',
      batchNo: 'BATCH-2026-001',
      serialNo: 'SR-001-100',
      returnQty: 50,
      receivedQty: 45,
      damagedQty: 45,
      shortageQty: 5,
      excessQty: 0,
      unitRate: 572.44,
      totalValue: 25760
    }],
    resolutionNotes: 'Insurance claim pending with transport company. Debit note raised to supplier.',
    correctiveAction: 'Contacted transport company for insurance claim process',
    preventiveAction: 'Implement better packaging standards with supplier',
    debitNoteNumber: 'DN-2026-001234',
    createdBy: 'System Admin'
  },
  {
    mrId: 'MR-2026-009',
    supplierName: 'Amit Kumar Enterprises',
    invoiceNumber: 'INV-2026-1234',
    invoiceDate: new Date('2026-04-20'),
    invoiceType: 'Purchase',
    lossType: 'QC Rejection',
    rootCause: 'Production Defect',
    lossAmount: 18600,
    recoverableAmount: 18600,
    responsibleDepartment: 'QC',
    responsiblePerson: 'Priya Sharma',
    priority: 'High',
    slaDueDate: new Date('2026-05-15'), // Past due date for closed case
    financialStatus: 'Debit Note Raised',
    materialStatus: 'Disposed',
    reconciliationStatus: 'Fully Reconciled',
    finalStatus: 'Closed',
    products: [{
      productName: 'Electrical Cables 2.5mm',
      skuCode: 'ELC-CBL-2.5MM',
      batchNo: 'BATCH-2026-002',
      returnQty: 100,
      receivedQty: 100,
      damagedQty: 100,
      shortageQty: 0,
      excessQty: 0,
      unitRate: 186,
      totalValue: 18600
    }],
    resolutionNotes: 'Material failed QC due to substandard quality. Full refund processed.',
    correctiveAction: 'Material disposed as per safety protocols',
    preventiveAction: 'Enhanced supplier quality audit process implemented',
    debitNoteNumber: 'DN-2026-001235',
    closedBy: 'QC Manager',
    closureDate: new Date('2026-05-10'),
    createdBy: 'QC Team'
  },
  {
    mrId: 'MR-2026-007',
    supplierName: 'Sundar Agencies Ltd',
    invoiceNumber: 'INV-2026-9900',
    invoiceDate: new Date('2026-05-01'),
    invoiceType: 'Purchase',
    lossType: 'Invoice Mismatch',
    rootCause: 'Invoice Error',
    lossAmount: 8680,
    recoverableAmount: 0,
    responsibleDepartment: 'Finance',
    responsiblePerson: 'Rahul Gupta',
    priority: 'Medium',
    slaDueDate: new Date(Date.now() + (168 * 60 * 60 * 1000)), // 7 days from now
    financialStatus: 'Pending',
    materialStatus: 'Received',
    reconciliationStatus: 'Open',
    finalStatus: 'Open',
    products: [{
      productName: 'PVC Pipes 4 inch',
      skuCode: 'PVC-PIPE-4IN',
      batchNo: 'BATCH-2026-003',
      returnQty: 20,
      receivedQty: 20,
      damagedQty: 0,
      shortageQty: 0,
      excessQty: 0,
      unitRate: 434,
      totalValue: 8680
    }],
    resolutionNotes: 'Invoice shows different quantity than received. Finance team investigating.',
    correctiveAction: 'Cross-verification with GRN and PO in progress',
    preventiveAction: 'Implement automated invoice matching system',
    createdBy: 'Finance Team'
  },
  {
    mrId: 'MR-2026-005',
    supplierName: 'Modern Steel Works',
    invoiceNumber: 'INV-2026-7890',
    invoiceDate: new Date('2026-05-12'),
    invoiceType: 'Purchase',
    lossType: 'Material Shortage',
    rootCause: 'Wrong Dispatch',
    lossAmount: 15400,
    recoverableAmount: 15400,
    responsibleDepartment: 'Procurement',
    responsiblePerson: 'Neha Singh',
    priority: 'Critical',
    slaDueDate: new Date(Date.now() - (24 * 60 * 60 * 1000)), // 1 day overdue
    financialStatus: 'Credit Note Issued',
    materialStatus: 'Pending Return',
    reconciliationStatus: 'Finance Closed',
    finalStatus: 'Escalated',
    escalationLevel: 1,
    products: [{
      productName: 'Cement Bags 50kg',
      skuCode: 'CMT-BAG-50KG',
      batchNo: 'BATCH-2026-004',
      returnQty: 100,
      receivedQty: 70,
      damagedQty: 0,
      shortageQty: 30,
      excessQty: 0,
      unitRate: 513.33,
      totalValue: 15400
    }],
    resolutionNotes: 'Short delivery of 30 bags. Supplier acknowledged error.',
    correctiveAction: 'Credit note issued for shortage amount',
    preventiveAction: 'Implement mandatory delivery verification process',
    creditNoteNumber: 'CN-2026-001001',
    createdBy: 'Procurement Team'
  },
  {
    mrId: 'MR-2026-003',
    supplierName: 'Tech Components India',
    invoiceNumber: 'INV-2026-5555',
    invoiceDate: new Date('2026-05-14'),
    invoiceType: 'Purchase',
    lossType: 'Expired Material',
    rootCause: 'Supplier Packing Issue',
    lossAmount: 32000,
    recoverableAmount: 25000,
    responsibleDepartment: 'Warehouse',
    responsiblePerson: 'Vikash Yadav',
    priority: 'Critical',
    slaDueDate: new Date(Date.now() + (24 * 60 * 60 * 1000)), // 1 day from now
    financialStatus: 'Debit Note Raised',
    materialStatus: 'Disposed',
    reconciliationStatus: 'Material Closed',
    finalStatus: 'In Progress',
    products: [{
      productName: 'Electronic Components Kit',
      skuCode: 'ELC-KIT-001',
      batchNo: 'BATCH-2026-005',
      serialNo: 'EK-2026-001',
      returnQty: 10,
      receivedQty: 10,
      damagedQty: 8,
      shortageQty: 0,
      excessQty: 0,
      unitRate: 4000,
      totalValue: 32000
    }],
    resolutionNotes: 'Material received with expired date. 80% material unusable.',
    correctiveAction: 'Expired material disposed as per protocol',
    preventiveAction: 'Implement expiry date verification at GRN stage',
    debitNoteNumber: 'DN-2026-001236',
    createdBy: 'Warehouse Manager'
  }
];

const seedProfessionalLossTracking = async () => {
  try {
    await connectDB();
    
    // Drop existing collection
    try {
      await mongoose.connection.db.dropCollection('losstrackings');
      console.log('Dropped existing loss tracking collection');
    } catch (error) {
      console.log('Collection does not exist, creating new one');
    }
    
    // Insert professional data
    const insertedRecords = await LossTracking.insertMany(professionalLossData);
    console.log(`Inserted ${insertedRecords.length} professional loss tracking records`);
    
    // Display summary
    console.log('\n📊 Professional ERP Loss Tracking Data Summary:');
    console.log('=' .repeat(60));
    
    insertedRecords.forEach(record => {
      console.log(`🔸 ${record.lossId}: ${record.supplierName}`);
      console.log(`   Loss Type: ${record.lossType} | Amount: ₹${record.lossAmount.toLocaleString('en-IN')}`);
      console.log(`   Status: ${record.finalStatus} | Department: ${record.responsibleDepartment}`);
      console.log(`   Reconciliation: ${record.reconciliationStatus}`);
      console.log('');
    });
    
    // Calculate totals
    const totalLoss = insertedRecords.reduce((sum, record) => sum + record.lossAmount, 0);
    const totalRecoverable = insertedRecords.reduce((sum, record) => sum + record.recoverableAmount, 0);
    
    console.log('💰 Financial Summary:');
    console.log(`   Total Loss Amount: ₹${totalLoss.toLocaleString('en-IN')}`);
    console.log(`   Total Recoverable: ₹${totalRecoverable.toLocaleString('en-IN')}`);
    console.log(`   Net Loss: ₹${(totalLoss - totalRecoverable).toLocaleString('en-IN')}`);
    
    console.log('\n✅ Professional ERP Loss Tracking system seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding professional loss tracking data:', error);
    process.exit(1);
  }
};

seedProfessionalLossTracking();