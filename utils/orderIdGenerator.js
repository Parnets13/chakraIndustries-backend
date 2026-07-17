import Counter from '../models/Counter.js';
import SalesOrder from '../models/SalesOrder.js';

/**
 * Atomically generate the next order ID for the current year.
 *
 * Root-cause of previous error:
 *   $setOnInsert: { sequence: X } + $inc: { sequence: 1 } in the SAME update
 *   both try to write the "sequence" path → MongoDB throws a conflict error.
 *
 * Fix:
 *   1. First upsert the counter doc WITHOUT touching sequence (just ensure it exists).
 *   2. Then atomically $inc sequence in a separate findOneAndUpdate.
 *
 *   OR — simpler and still atomic:
 *   Use two steps only on first-time insert (upsert with $setOnInsert for the
 *   initial value, then immediately $inc).  But the safest single-operation
 *   approach is to drop $setOnInsert entirely and let the Counter start at 0,
 *   then seed it to the real max if it was just created.
 */
export const genOrderId = async () => {
  const year   = new Date().getFullYear();
  const prefix = `ORD-${year}-`;

  try {
    // ── Step 1: ensure the counter document exists (no sequence touch) ───────
    await Counter.updateOne(
      { name: 'orderId', year },
      { $setOnInsert: { sequence: 0 } },
      { upsert: true }
    );

    // ── Step 2: if counter is at 0 (just created), seed it from existing orders
    const counter0 = await Counter.findOne({ name: 'orderId', year });
    if (counter0 && counter0.sequence === 0) {
      const lastOrder = await SalesOrder.findOne(
        { orderId: { $regex: `^${prefix}` } },
        { orderId: 1 }
      ).sort({ orderId: -1 });

      if (lastOrder?.orderId) {
        const parts  = lastOrder.orderId.split('-');
        const parsed = parseInt(parts[2], 10);
        if (!isNaN(parsed) && parsed > 0) {
          await Counter.updateOne(
            { name: 'orderId', year, sequence: 0 },   // only update if still 0
            { $set: { sequence: parsed } }
          );
        }
      }
    }

    // ── Step 3: atomic increment — this is now a clean single-path update ────
    const updated = await Counter.findOneAndUpdate(
      { name: 'orderId', year },
      { $inc: { sequence: 1 } },
      { new: true }
    );

    const orderId = `${prefix}${String(updated.sequence).padStart(6, '0')}`;
    console.log(`[genOrderId] ✅ ${orderId} (seq ${updated.sequence})`);
    return orderId;

  } catch (error) {
    // ── Fallback: timestamp-based ID so the order still saves ────────────────
    const fallback = `${prefix}${Date.now()}`;
    console.error(`[genOrderId] ❌ Error, using fallback ${fallback}:`, error.message);
    return fallback;
  }
};
