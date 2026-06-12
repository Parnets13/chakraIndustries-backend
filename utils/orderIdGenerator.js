import SalesOrder from '../models/SalesOrder.js';

/**
 * Generate a unique order ID: ORD-YYYY-NNNN
 * Uses retry logic for duplicate key errors to avoid race conditions
 */
export const genOrderId = async () => {
  const maxRetries = 3;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      const year = new Date().getFullYear();
      const prefix = `ORD-${year}-`;

      // Find the highest existing order ID for this year
      const last = await SalesOrder.findOne(
        { orderId: new RegExp(`^${prefix}`) },
        { orderId: 1 },
        { sort: { orderId: -1 } }
      );

      let nextNum = 1;
      if (last?.orderId) {
        const parts = last.orderId.split('-');
        const parsed = parseInt(parts[2], 10);
        if (!isNaN(parsed)) {
          nextNum = parsed + 1;
        }
      }

      // Always use 4-digit padding for consistency
      return `${prefix}${String(nextNum).padStart(4, '0')}`;
    } catch (error) {
      attempts++;
      if (attempts >= maxRetries) {
        throw error;
      }
      // Wait a short time before retrying
      await new Promise(resolve => setTimeout(resolve, 100 * attempts));
    }
  }
};
