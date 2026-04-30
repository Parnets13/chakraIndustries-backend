import Inventory from '../models/Inventory.js';

/**
 * Update inventory when GRN is received
 */
export const updateInventoryFromGRN = async (grn, warehouseId) => {
  try {
    if (!grn.items || grn.items.length === 0) {
      return;
    }

    for (const item of grn.items) {
      // Find or create inventory item
      let inventory = await Inventory.findOne({
        sku: item.sku,
        warehouse: warehouseId
      });

      if (!inventory) {
        // Create new inventory item
        inventory = new Inventory({
          sku: item.sku,
          name: item.itemName || item.sku,
          warehouse: warehouseId,
          totalQuantity: item.quantity || 0,
          availableQuantity: item.quantity || 0,
          reservedQuantity: 0,
          minQuantity: 0,
          unit: item.unit || 'pieces',
          batch: item.batch || null,
          status: 'Active',
          unitPrice: item.unitPrice || 0,
          grnId: grn._id
        });
      } else {
        // Update existing inventory
        inventory.totalQuantity += item.quantity || 0;
        inventory.availableQuantity = inventory.totalQuantity - inventory.reservedQuantity;
        inventory.grnId = grn._id;
      }

      await inventory.save();
    }

    console.log('Inventory updated from GRN:', grn._id);
  } catch (error) {
    console.error('Error updating inventory from GRN:', error);
    throw error;
  }
};

/**
 * Reverse inventory when GRN is cancelled
 */
export const reverseInventoryFromGRN = async (grn, warehouseId) => {
  try {
    if (!grn.items || grn.items.length === 0) {
      return;
    }

    for (const item of grn.items) {
      const inventory = await Inventory.findOne({
        sku: item.sku,
        warehouse: warehouseId
      });

      if (inventory) {
        // Reduce quantity
        inventory.totalQuantity = Math.max(0, inventory.totalQuantity - (item.quantity || 0));
        inventory.availableQuantity = inventory.totalQuantity - inventory.reservedQuantity;
        
        // Update status
        if (inventory.totalQuantity === 0) {
          inventory.status = 'Dead';
        } else if (inventory.availableQuantity < inventory.minQuantity) {
          inventory.status = 'Critical';
        } else {
          inventory.status = 'Active';
        }

        await inventory.save();
      }
    }

    console.log('Inventory reversed from GRN:', grn._id);
  } catch (error) {
    console.error('Error reversing inventory from GRN:', error);
    throw error;
  }
};

/**
 * Get inventory by SKU and warehouse
 */
export const getInventoryBySKU = async (sku, warehouseId) => {
  try {
    const inventory = await Inventory.findOne({
      sku: sku.toUpperCase(),
      warehouse: warehouseId
    });
    return inventory;
  } catch (error) {
    console.error('Error getting inventory:', error);
    throw error;
  }
};

/**
 * Adjust inventory quantity
 */
export const adjustInventoryQuantity = async (sku, warehouseId, quantity, type = 'add') => {
  try {
    const inventory = await Inventory.findOne({
      sku: sku.toUpperCase(),
      warehouse: warehouseId
    });

    if (!inventory) {
      throw new Error(`Inventory not found for SKU: ${sku}`);
    }

    if (type === 'add') {
      inventory.totalQuantity += quantity;
    } else if (type === 'subtract') {
      inventory.totalQuantity = Math.max(0, inventory.totalQuantity - quantity);
    } else if (type === 'set') {
      inventory.totalQuantity = quantity;
    }

    inventory.availableQuantity = inventory.totalQuantity - inventory.reservedQuantity;

    // Update status
    if (inventory.totalQuantity === 0) {
      inventory.status = 'Dead';
    } else if (inventory.availableQuantity < inventory.minQuantity) {
      inventory.status = 'Critical';
    } else {
      inventory.status = 'Active';
    }

    await inventory.save();
    return inventory;
  } catch (error) {
    console.error('Error adjusting inventory:', error);
    throw error;
  }
};


// Default export for compatibility
export default {
  updateInventoryFromGRN,
  reverseInventoryFromGRN,
  getInventoryBySKU,
  adjustInventoryQuantity
};
