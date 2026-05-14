import BulkOrder from '../models/BulkOrder.js';
import Inventory from '../models/Inventory.js';
import WorkOrder from '../models/WorkOrder.js';
import BOM from '../models/BOM.js';

const generateWorkOrderId = async () => {
  const last = await WorkOrder.findOne({}, {}, { sort: { createdAt: -1 } });
  if (!last) return 'WO-2024-001';
  const num = parseInt(last.workOrderId?.split('-')[2] || '0') + 1;
  return `WO-2024-${String(num).padStart(3, '0')}`;
};

// Check inventory for all items in bulk order
export const checkInventory = async (req, res) => {
  try {
    const { orderId } = req.params;
    const bulkOrder = await BulkOrder.findById(orderId);
    if (!bulkOrder) return res.status(404).json({ success: false, message: 'Order not found' });

    const inventoryCheck = [];
    let allInStock = true;
    let partialStock = false;

    for (const item of bulkOrder.items) {
      const inventory = await Inventory.findOne({ sku: item.sku });
      
      if (!inventory) {
        inventoryCheck.push({
          sku: item.sku,
          itemName: item.itemName,
          required: item.qty,
          available: 0,
          status: 'Out of Stock'
        });
        allInStock = false;
      } else if (inventory.availableQuantity >= item.qty) {
        inventoryCheck.push({
          sku: item.sku,
          itemName: item.itemName,
          required: item.qty,
          available: inventory.availableQuantity,
          status: 'In Stock'
        });
      } else if (inventory.availableQuantity > 0) {
        inventoryCheck.push({
          sku: item.sku,
          itemName: item.itemName,
          required: item.qty,
          available: inventory.availableQuantity,
          status: 'Partial Stock'
        });
        allInStock = false;
        partialStock = true;
      } else {
        inventoryCheck.push({
          sku: item.sku,
          itemName: item.itemName,
          required: item.qty,
          available: 0,
          status: 'Out of Stock'
        });
        allInStock = false;
      }
    }

    // Update bulk order inventory status
    let inventoryStatus = 'In Stock';
    if (!allInStock && partialStock) inventoryStatus = 'Partial Stock';
    if (!allInStock && !partialStock) inventoryStatus = 'Out of Stock';

    bulkOrder.inventoryStatus = inventoryStatus;
    await bulkOrder.save();

    res.json({ success: true, data: { orderId, inventoryStatus, items: inventoryCheck } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Reserve inventory when order is approved
export const reserveInventory = async (req, res) => {
  try {
    const { orderId } = req.params;
    const bulkOrder = await BulkOrder.findById(orderId);
    if (!bulkOrder) return res.status(404).json({ success: false, message: 'Order not found' });

    const reservations = [];

    for (const item of bulkOrder.items) {
      const inventory = await Inventory.findOne({ sku: item.sku });
      if (!inventory) {
        return res.status(400).json({ success: false, message: `Item ${item.sku} not found in inventory` });
      }

      if (inventory.availableQuantity < item.qty) {
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient stock for ${item.sku}. Available: ${inventory.availableQuantity}, Required: ${item.qty}` 
        });
      }

      // Reserve inventory
      inventory.availableQuantity -= item.qty;
      inventory.reservedQuantity += item.qty;
      await inventory.save();

      reservations.push({
        sku: item.sku,
        qty: item.qty,
        reserved: true
      });
    }

    bulkOrder.status = 'Inventory Check';
    await bulkOrder.save();

    res.json({ success: true, data: { orderId, reservations, message: 'Inventory reserved' } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Auto-create work order if stock is insufficient
export const createWorkOrderForShortage = async (req, res) => {
  try {
    const { orderId } = req.params;
    const bulkOrder = await BulkOrder.findById(orderId);
    if (!bulkOrder) return res.status(404).json({ success: false, message: 'Order not found' });

    const workOrders = [];

    for (const item of bulkOrder.items) {
      const inventory = await Inventory.findOne({ sku: item.sku });
      
      if (!inventory || inventory.availableQuantity < item.qty) {
        const shortage = item.qty - (inventory?.availableQuantity || 0);

        // Find BOM for this item
        const bom = await BOM.findOne({ sku: item.sku });
        if (!bom) {
          return res.status(400).json({ success: false, message: `BOM not found for ${item.sku}` });
        }

        // Create work order
        const workOrderId = await generateWorkOrderId();
        const workOrder = await WorkOrder.create({
          workOrderId,
          sku: item.sku,
          itemName: item.itemName,
          quantity: shortage,
          bomId: bom._id,
          materialConsumption: bom.components,
          status: 'Draft',
          priority: 'High',
          dueDate: bulkOrder.deliveryDate,
          createdBy: req.user?._id
        });

        bulkOrder.workOrderId = workOrderId;
        workOrders.push(workOrder);
      }
    }

    bulkOrder.status = 'Production';
    await bulkOrder.save();

    res.json({ success: true, data: { orderId, workOrders, message: 'Work orders created for shortage' } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Release reserved inventory if order is cancelled
export const releaseReservedInventory = async (req, res) => {
  try {
    const { orderId } = req.params;
    const bulkOrder = await BulkOrder.findById(orderId);
    if (!bulkOrder) return res.status(404).json({ success: false, message: 'Order not found' });

    for (const item of bulkOrder.items) {
      const inventory = await Inventory.findOne({ sku: item.sku });
      if (inventory) {
        inventory.availableQuantity += item.qty;
        inventory.reservedQuantity -= item.qty;
        await inventory.save();
      }
    }

    bulkOrder.status = 'Cancelled';
    await bulkOrder.save();

    res.json({ success: true, data: { orderId, message: 'Reserved inventory released' } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
