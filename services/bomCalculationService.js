import BOM from '../models/BOM.js';
import Inventory from '../models/Inventory.js';
import ItemMaster from '../models/ItemMaster.js';

/**
 * Calculate required materials based on BOM and production quantity
 * Supports multi-level BOM expansion (sub-assemblies to raw materials)
 */
export const calculateRequiredMaterials = async (bomId, productionQty) => {
  try {
    const bom = await BOM.findById(bomId);
    if (!bom) throw new Error('BOM not found');

    const requiredMaterials = [];
    const processedItems = new Set();

    // Recursively expand BOM components
    const expandBOM = async (bomObj, multiplier = 1) => {
      if (!bomObj.components) return;

      for (const component of bomObj.components) {
        const requiredQty = component.qty * multiplier * productionQty;
        const itemKey = component.itemId?.toString() || component.itemName;

        // Check if this is a sub-assembly (has its own BOM)
        const subBOM = await BOM.findOne({ product: component.itemName, status: 'Active' });

        if (subBOM) {
          // Recursively expand sub-assembly
          await expandBOM(subBOM, requiredQty / component.qty);
        } else {
          // This is a raw material
          if (!processedItems.has(itemKey)) {
            requiredMaterials.push({
              itemId: component.itemId,
              itemName: component.itemName,
              sku: component.sku,
              requiredQty,
              unit: component.unit,
              isSubAssembly: false
            });
            processedItems.add(itemKey);
          } else {
            // Aggregate quantities for duplicate items
            const existing = requiredMaterials.find(m => m.itemKey === itemKey);
            if (existing) {
              existing.requiredQty += requiredQty;
            }
          }
        }
      }
    };

    await expandBOM(bom);
    return requiredMaterials;
  } catch (error) {
    throw new Error(`BOM calculation failed: ${error.message}`);
  }
};

/**
 * Check inventory availability for required materials
 */
export const checkInventoryAvailability = async (requiredMaterials) => {
  try {
    const materialStatus = [];
    let allAvailable = true;

    for (const material of requiredMaterials) {
      // Find inventory by itemId or SKU
      const inventory = await Inventory.findOne({
        $or: [
          { _id: material.itemId },
          { sku: material.sku }
        ],
        status: { $ne: 'Inactive' }
      });

      if (!inventory) {
        materialStatus.push({
          ...material,
          availableQty: 0,
          shortfall: material.requiredQty,
          status: 'Unavailable'
        });
        allAvailable = false;
      } else {
        const available = inventory.availableQuantity || 0;
        const shortfall = Math.max(0, material.requiredQty - available);

        materialStatus.push({
          ...material,
          inventoryId: inventory._id,
          availableQty: available,
          shortfall,
          status: shortfall > 0 ? (available > 0 ? 'Partial' : 'Unavailable') : 'Available'
        });

        if (shortfall > 0) allAvailable = false;
      }
    }

    return {
      materials: materialStatus,
      allAvailable,
      totalShortfall: materialStatus.reduce((sum, m) => sum + m.shortfall, 0)
    };
  } catch (error) {
    throw new Error(`Inventory check failed: ${error.message}`);
  }
};

/**
 * Reserve inventory for work order
 */
export const reserveInventory = async (requiredMaterials) => {
  try {
    const reservations = [];

    for (const material of requiredMaterials) {
      if (material.status === 'Unavailable') {
        throw new Error(`Insufficient inventory for ${material.itemName}`);
      }

      const inventory = await Inventory.findByIdAndUpdate(
        material.inventoryId,
        {
          $inc: { reservedQuantity: material.requiredQty },
          updatedAt: new Date()
        },
        { new: true }
      );

      reservations.push({
        itemId: material.itemId,
        inventoryId: material.inventoryId,
        qty: material.requiredQty,
        reservedAt: new Date()
      });
    }

    return reservations;
  } catch (error) {
    throw new Error(`Inventory reservation failed: ${error.message}`);
  }
};

/**
 * Release reserved inventory (for cancelled work orders)
 */
export const releaseReservedInventory = async (reservations) => {
  try {
    for (const reservation of reservations) {
      await Inventory.findByIdAndUpdate(
        reservation.inventoryId,
        {
          $inc: { reservedQuantity: -reservation.qty },
          updatedAt: new Date()
        }
      );
    }
    return true;
  } catch (error) {
    throw new Error(`Inventory release failed: ${error.message}`);
  }
};

/**
 * Consume inventory when production completes
 */
export const consumeInventory = async (reservations, actualProduced, plannedQty) => {
  try {
    const consumptionRatio = actualProduced / plannedQty;
    const consumed = [];

    for (const reservation of reservations) {
      const consumedQty = reservation.qty * consumptionRatio;

      const inventory = await Inventory.findByIdAndUpdate(
        reservation.inventoryId,
        {
          $inc: {
            totalQuantity: -consumedQty,
            reservedQuantity: -reservation.qty,
            availableQuantity: -consumedQty
          },
          updatedAt: new Date()
        },
        { new: true }
      );

      consumed.push({
        itemId: reservation.itemId,
        inventoryId: reservation.inventoryId,
        qty: consumedQty,
        consumedAt: new Date()
      });
    }

    return consumed;
  } catch (error) {
    throw new Error(`Inventory consumption failed: ${error.message}`);
  }
};
