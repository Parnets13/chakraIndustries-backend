
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import Invoice from './models/Invoice.js';

async function resetRetryCounts() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    const result = await Invoice.updateMany(
      { 
        status: { $nin: ['Cancelled'] }, 
        source: { $nin: ['Tally', 'tally'] }, 
        tallySync: { $ne: true }, 
        retryCount: { $gt: 4 } 
      },
      { $set: { retryCount: 0, lastError: null, lastTriedAt: null } }
    );

    console.log(`Reset retry counts for ${result.modifiedCount} invoices`);
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

resetRetryCounts();
