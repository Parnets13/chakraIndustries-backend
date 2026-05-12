import Batch from '../models/Batch.js';
import Inventory from '../models/Inventory.js';
import GRN from '../models/GRN.js';

/**
 * Create batch from GRN
 * Called when GRN is created or updated
 */
export const createBatchFromGRN = async (grn) => {
  try {
    // Skip if no batch number provided
    if (!grn.batchNo) {
      return null;
    }

    // Check if batch already exists
    let batch = await Batch.findOne({ batchNo: grn.batchNo });
    
    if (!batch) {
      // Calculate shelf life percentage
      const mfgD = grn.mfgDate ? new Date(grn.mfgDate) : new Date();
      const expD = grn.expiryDate ? new Date(grn.expiryDate) : new Date();
      const totalDays = (expD - mfgD) / (1000 * 60 * 60 * 24);
      const remainingDays = (expD - new Date()) / (1000 * 60 * 60 * 24);
      const shelfLifePct = Math.max(0, Math.min(100, Math.round((remainingDays / totalDays) * 100)));
      
      const status = shelfLifePct < 20 ? 'Critical' : shelfLifePct < 0 ? 'Expired' : 'Active';
      
      batch = new Batch({
        batchNo: grn.batchNo,
        sku: grn.items?.[0]?.itemName || 'UNKNOWN',
        itemName: grn.items?.[0]?.itemName || 'Unknown Item',
        quantity: grn.acceptedQuantity || grn.receivedQuantity,
        mfgDate: grn.mfgDate,
        expiryDate: grn.expiryDate,
        warehouse: grn.warehouseId,
        shelfLifePercentage: shelfLifePct,
        status,
        grnId: grn._id,
        vendorId: grn.vendorId,
        poId: grn.poId
      });
      
      await batch.save();
    }
    
    // Update GRN with batch reference
    if (batch) {
      grn.batchId = batch._id;
      await grn.save();
    }
    
    return batch;
  } catch (error) {
    console.error('Error creating batch from GRN:', error);
    throw error;
  }
};

/**
 * Create inventory from GRN
 * Called when GRN QC is approved
 */
export const createInventoryFromGRN = async (grn) => {
  try {
    if (!grn.acceptedQuantity || grn.acceptedQuantity === 0) {
      throw new Error('No accepted quantity to add to inventory');
    }

    // Get or create batch
    let batch = await Batch.findById(grn.batchId);
    if (!batch) {
      batch = await createBatchFromGRN(grn);
    }

    // Check if inventory already exists for this batch
    let inventory = await Inventory.findOne({
      sku: grn.items?.[0]?.itemName,
      warehouse: grn.warehouseId,
      batch: grn.batchNo
    });

    if (!inventory) {
      inventory = new Inventory({
        sku: grn.items?.[0]?.itemName || 'UNKNOWN',
        name: grn.items?.[0]?.itemName || 'Unknown Item',
        warehouse: grn.warehouseId,
        totalQuantity: grn.acceptedQuantity,
        availableQuantity: grn.acceptedQuantity,
        reservedQuantity: 0,
        minQuantity: 0,
        unit: grn.items?.[0]?.unit || 'units',
        batch: grn.batchNo,
        status: 'Active',
        grnId: grn._id,
        batchId: batch._id,
        vendorId: grn.vendorId,
        poId: grn.poId,
        mfgDate: grn.mfgDate,
        expiryDate: grn.expiryDate,
        location: {
          zone: 'A',
          rack: '1',
          shelf: '1',
          bin: '1'
        }
      });
      
      await inventory.save();
    } else {
      // Update existing inventory
      inventory.totalQuantity += grn.acceptedQuantity;
      inventory.availableQuantity = inventory.totalQuantity - inventory.reservedQuantity;
      await inventory.save();
    }

    // Update GRN with inventory reference
    grn.inventoryId = inventory._id;
    grn.grnStatus = 'Inventory_Updated';
    await grn.save();

    // Update batch with inventory reference
    batch.inventoryId = inventory._id;
    batch.quantity = inventory.totalQuantity;
    await batch.save();

    return inventory;
  } catch (error) {
    console.error('Error creating inventory from GRN:', error);
    throw error;
  }
};

/**
 * Update inventory when picking is done
 * Reduces available quantity
 */
export const updateInventoryFromPicking = async (inventoryId, pickedQuantity) => {
  try {
    const inventory = await Inventory.findById(inventoryId);
    if (!inventory) {
      throw new Error('Inventory not found');
    }

    if (inventory.availableQuantity < pickedQuantity) {
      throw new Error('Insufficient available quantity');
    }

    inventory.availableQuantity -= pickedQuantity;
    inventory.totalQuantity -= pickedQuantity;
    inventory.lastMovementDate = new Date();
    
    await inventory.save();

    return inventory;
  } catch (error) {
    console.error('Error updating inventory from picking:', error);
    throw error;
  }
};

/**
 * Get batch details with inventory
 */
export const getBatchWithInventory = async (batchNo) => {
  try {
    const batch = await Batch.findOne({ batchNo })
      .populate('grnId')
      .populate('inventoryId')
      .populate('vendorId', 'name')
      .populate('poId', 'poId');
    
    return batch;
  } catch (error) {
    console.error('Error getting batch with inventory:', error);
    throw error;
  }
};
