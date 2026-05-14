import CorporateClient from '../models/CorporateClient.js';
import BulkOrder from '../models/BulkOrder.js';

// Check credit limit before approving order
export const checkCreditLimit = async (req, res) => {
  try {
    const { clientId, orderValue } = req.body;

    const client = await CorporateClient.findOne({ clientId });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    const availableCredit = client.creditLimit - client.outstanding;
    const creditCheckPassed = availableCredit >= orderValue;

    res.json({ success: true, data: {
      clientId,
      creditLimit: client.creditLimit,
      outstanding: client.outstanding,
      availableCredit,
      orderValue,
      creditCheckPassed,
      message: creditCheckPassed ? 'Credit check passed' : 'Insufficient credit limit'
    }});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Reserve credit when order is approved
export const reserveCredit = async (req, res) => {
  try {
    const { orderId } = req.params;
    const bulkOrder = await BulkOrder.findById(orderId);
    if (!bulkOrder) return res.status(404).json({ success: false, message: 'Order not found' });

    const client = await CorporateClient.findOne({ clientId: bulkOrder.clientId });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    // Check if credit is available
    const availableCredit = client.creditLimit - client.outstanding;
    if (availableCredit < bulkOrder.grandTotal) {
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient credit. Available: ₹${availableCredit}, Required: ₹${bulkOrder.grandTotal}` 
      });
    }

    // Reserve credit
    client.outstanding += bulkOrder.grandTotal;
    await client.save();

    bulkOrder.creditCheckPassed = true;
    bulkOrder.creditCheckDetails = {
      availableCredit: availableCredit - bulkOrder.grandTotal,
      usedCredit: client.outstanding,
      requiredCredit: bulkOrder.grandTotal,
      passed: true
    };
    await bulkOrder.save();

    res.json({ success: true, data: { orderId, creditReserved: bulkOrder.grandTotal, message: 'Credit reserved' } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Release reserved credit if order is cancelled
export const releaseCredit = async (req, res) => {
  try {
    const { orderId } = req.params;
    const bulkOrder = await BulkOrder.findById(orderId);
    if (!bulkOrder) return res.status(404).json({ success: false, message: 'Order not found' });

    const client = await CorporateClient.findOne({ clientId: bulkOrder.clientId });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    // Release credit
    client.outstanding -= bulkOrder.grandTotal;
    await client.save();

    bulkOrder.creditCheckPassed = false;
    await bulkOrder.save();

    res.json({ success: true, data: { orderId, creditReleased: bulkOrder.grandTotal, message: 'Credit released' } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Get credit summary for client
export const getClientCreditSummary = async (req, res) => {
  try {
    const { clientId } = req.params;

    const client = await CorporateClient.findOne({ clientId });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    // Get all orders for this client
    const orders = await BulkOrder.find({ clientId });
    const totalOrders = orders.length;
    const totalOrderValue = orders.reduce((sum, o) => sum + (o.grandTotal || 0), 0);
    const paidOrders = orders.filter(o => o.status === 'Delivered').length;

    res.json({ success: true, data: {
      clientId,
      clientName: client.name,
      creditLimit: client.creditLimit,
      outstanding: client.outstanding,
      availableCredit: client.creditLimit - client.outstanding,
      utilizationPercent: ((client.outstanding / client.creditLimit) * 100).toFixed(1),
      totalOrders,
      totalOrderValue,
      paidOrders,
      pendingOrders: totalOrders - paidOrders
    }});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
