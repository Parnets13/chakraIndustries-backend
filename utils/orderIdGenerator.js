import Counter from '../models/Counter.js';
import SalesOrder from '../models/SalesOrder.js';

export const genOrderId = async () => {
  const year = new Date().getFullYear();
  
  console.log(`[genOrderId] Starting atomic order ID generation for year ${year}`);

  try {
    // Step 1: First check the MAX sequence from existing SalesOrders for this year
    const prefix = `ORD-${year}-`;
    const lastOrder = await SalesOrder.findOne(
      { orderId: { $regex: `^${prefix}` } },
      { orderId: 1 }
    ).sort({ orderId: -1 });

    let initialSequence = 0;
    if (lastOrder?.orderId) {
      const parts = lastOrder.orderId.split('-');
      const parsed = parseInt(parts[2], 10);
      if (!isNaN(parsed)) {
        initialSequence = parsed;
      }
    }
    console.log(`[genOrderId] Initial sequence from last order: ${initialSequence}`);

    // Step 2: ATOMIC findOneAndUpdate with upsert that ensures we never get duplicates
    // This is a single MongoDB operation, so no race conditions!
    const counter = await Counter.findOneAndUpdate(
      { name: 'orderId', year: year },
      {
        $setOnInsert: { sequence: initialSequence },
        $inc: { sequence: 1 }
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    const orderId = `ORD-${year}-${String(counter.sequence).padStart(6, '0')}`;
    console.log(`[genOrderId] ✅ Successfully generated order ID: ${orderId} (sequence: ${counter.sequence})`);
    return orderId;

  } catch (error) {
    console.error(`[genOrderId] ❌ Error generating order ID:`, error);
    throw error;
  }
};