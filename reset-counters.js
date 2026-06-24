import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Counter from './models/Counter.js';
import SalesOrder from './models/SalesOrder.js';

dotenv.config();

const resetCounters = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Find all years present in SalesOrder
    const orderYears = await SalesOrder.aggregate([
      {
        $group: {
          _id: null,
          orderIds: { $push: '$orderId' }
        }
      }
    ]);

    const years = new Set();
    if (orderYears.length > 0 && orderYears[0].orderIds) {
      orderYears[0].orderIds.forEach(orderId => {
        const parts = orderId.split('-');
        if (parts.length >= 2) {
          years.add(parseInt(parts[1], 10));
        }
      });
    }

    // Add current year
    years.add(new Date().getFullYear());

    console.log('Processing years:', Array.from(years));

    for (const year of Array.from(years)) {
      const prefix = `ORD-${year}-`;
      
      // Get the highest order number for this year
      const lastOrder = await SalesOrder.findOne(
        { orderId: { $regex: `^${prefix}` } },
        { orderId: 1 }
      ).sort({ orderId: -1 });

      let maxSequence = 0;
      if (lastOrder?.orderId) {
        const parts = lastOrder.orderId.split('-');
        const parsed = parseInt(parts[2], 10);
        if (!isNaN(parsed)) {
          maxSequence = parsed;
        }
      }

      console.log(`Year ${year}: Highest order sequence is ${maxSequence}`);

      // Update or create counter
      const counter = await Counter.findOneAndUpdate(
        { name: 'orderId', year },
        {
          name: 'orderId',
          year,
          sequence: maxSequence
        },
        {
          upsert: true,
          new: true
        }
      );

      console.log(`✅ Counter for year ${year} set to ${counter.sequence}`);
    }

    console.log('\n✅ All counters reset successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error resetting counters:', error);
    process.exit(1);
  }
};

resetCounters();