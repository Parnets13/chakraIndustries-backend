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

const sampleLossData = [
  {
    mrId: 'MR-2026-011',
    supplierName: 'Rajesh Traders',
    invoiceNo: 'INV-2026-5678',
    lossType: 'Courier lost parcel',
    lossAmount: 5760,
    priority: 'High',
    resolution: 'Insurance claim pending with Delivery',
    status: 'Open',
    createdDate: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000), // 12 days ago
    notes: [{
      note: 'Parcel lost during transit. Insurance claim initiated.',
      addedBy: 'System',
      addedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000)
    }]
  },
  {
    mrId: 'MR-2026-009',
    supplierName: 'Amit Kumar',
    invoiceNo: 'INV-2026-1234',
    lossType: 'QC rejected damaged',
    lossAmount: 3600,
    priority: 'High',
    resolution: 'Material damaged in transit — courier liability',
    status: 'In Progress',
    createdDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    notes: [{
      note: 'QC team rejected due to damage. Investigating courier liability.',
      addedBy: 'QC Team',
      addedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    }]
  },
  {
    mrId: 'MR-2026-007',
    supplierName: 'Sundar Agencies',
    invoiceNo: 'INV-2026-9900',
    lossType: 'CN not generated',
    lossAmount: 1680,
    priority: 'Medium',
    resolution: 'QC done — finance team ne CN abhi approve nahi kiya',
    status: 'Open',
    createdDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    notes: [{
      note: 'QC completed but credit note approval pending from finance team.',
      addedBy: 'Finance Team',
      addedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    }]
  },
  {
    mrId: 'MR-2026-005',
    supplierName: 'Amit Kumar',
    invoiceNo: 'INV-2026-7890',
    lossType: 'CN/DN amount mismatch',
    lossAmount: 400,
    priority: 'Low',
    resolution: 'DN ₹4,200 but CN ₹3,800 — reconcile difference',
    status: 'Open',
    createdDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    notes: [{
      note: 'Amount mismatch identified during reconciliation.',
      addedBy: 'Accounts Team',
      addedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
    }]
  }
];

const seedLossTracking = async () => {
  try {
    await connectDB();
    
    // Drop the collection to remove any old indexes
    try {
      await mongoose.connection.db.dropCollection('losstrackings');
      console.log('Dropped existing loss tracking collection');
    } catch (error) {
      console.log('Collection does not exist, creating new one');
    }
    
    // Insert sample data
    const insertedRecords = await LossTracking.insertMany(sampleLossData);
    console.log(`Inserted ${insertedRecords.length} loss tracking records`);
    
    // Display inserted records
    insertedRecords.forEach(record => {
      console.log(`- ${record.mrId}: ${record.supplierName} - ₹${record.lossAmount} (${record.lossType})`);
    });
    
    console.log('Loss tracking data seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding loss tracking data:', error);
    process.exit(1);
  }
};

seedLossTracking();