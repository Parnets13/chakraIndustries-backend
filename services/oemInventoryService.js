import OEMOrder from '../models/OEMOrder.js';
import InventoryItem from '../models/InventoryItem.js';
import StockMovement from '../models/StockMovement.js';
import PurchaseRequisition from '../models/PurchaseRequisition.js';
import WorkOrder from '../models/WorkOrder.js';

/**
 * Validate inventory for OEM order
 * Check if all required materials are available
 */
export const validateOEMInventory = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId).populate('bomId');
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    const bom = oemOrder.bomId;
    const validationResult = {
      allAvailable: true,
      materials: [],
      shortfalls: []
    };

    for (const component of bom.components) {
      const requiredQty = component.qty * (1 + (component.scrapFactor || 0) / 100) * oemOrder.quantity;
      
      // Find inventory items
      const invItems = await InventoryItem.find({
        $or: [
          { sku: component.itemCode || '' },
          { name: new RegExp(component.itemName, 'i') }
        ]
      });
      const availableQty = invItems.reduce((sum, item) => sum + (item.qty || 0), 0);
      const isAvailable = availableQty >= requiredQty;

      validationResult.materials.push({
        materialId: component.itemMasterId,
        materialName: component.itemName,
        sku: component.itemCode,
        requiredQty: Math.round(requiredQty * 1000) / 1000,
        availableQty,
        isAvailable,
        shortfall: Math.max(0, requiredQty - availableQty)
      });

      if (!isAvailable) {
        validationResult.allAvailable = false;
        validationResult.shortfalls.push({
          materialId: component.itemMasterId,
          materialName: component.itemName,
          shortfallQty: requiredQty - availableQty
        });
      }
    }

    // Update OEM order inventory status
    oemOrder.inventoryStatus = validationResult.allAvailable ? 'Validated' : 'Partial';
    await oemOrder.save();

    return {
      success: true,
      data: validationResult
    };
  } catch (error) {
    console.error('❌ Inventory validation failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Reserve materials for OEM order
 * Lock inventory for production
 */
export const reserveOEMMaterials = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId).populate('bomId');
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    const bom = oemOrder.bomId;
    const reservedInventory = [];
    const failedReservations = [];

    for (const component of bom.components) {
      const requiredQty = component.qty * (1 + (component.scrapFactor || 0) / 100) * oemOrder.quantity;
      
      // Find inventory items
      const invItems = await InventoryItem.find({
        $or: [
          { sku: component.itemCode || '' },
          { name: new RegExp(component.itemName, 'i') }
        ]
      }).sort({ qty: -1 });
      
      let remainingQty = requiredQty;
      const reservedForComponent = [];

      for (const invItem of invItems) {
        if (remainingQty <= 0) break;
        
        const toReserve = Math.min(invItem.qty, remainingQty);
        if (toReserve > 0) {
          invItem.qty -= toReserve;
          invItem.reservedQuantity = (invItem.reservedQuantity || 0) + toReserve;
          await invItem.save();
          
          reservedForComponent.push({
            itemId: component.itemMasterId,
            inventoryId: invItem._id,
            qty: toReserve,
            reservedAt: new Date()
          });
          
          // Create stock movement
          await StockMovement.create({
            movementId: await generateMovementId(),
            type: 'Reserved',
            sku: invItem.sku || component.itemCode,
            name: component.itemName,
            qty: -toReserve,
            from: invItem.warehouse,
            to: 'Reserved',
            ref: oemOrder.oemOrderId,
            remarks: `Reserved for OEM Order: ${oemOrder.oemOrderId}`
          });
          
          remainingQty -= toReserve;
        }
      }

      if (remainingQty > 0) {
        failedReservations.push({
          materialId: component.itemMasterId,
          materialName: component.itemName,
          required: requiredQty,
          available: requiredQty - remainingQty
        });
      } else {
        reservedInventory.push(...reservedForComponent);
      }
    }

    if (failedReservations.length > 0) {
      return {
        success: false,
        message: 'Some materials could not be reserved',
        data: {
          reserved: reservedInventory,
          failed: failedReservations
        }
      };
    }

    // Update OEM order
    oemOrder.reservedInventory = reservedInventory;
    oemOrder.inventoryStatus = 'Reserved';
    oemOrder.status = 'Material-Reserved';
    await oemOrder.save();

    console.log(`✅ Materials reserved for OEM Order: ${oemOrder.oemOrderId}`);
    return {
      success: true,
      message: 'Materials reserved successfully',
      data: oemOrder
    };
  } catch (error) {
    console.error('❌ Material reservation failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Generate movement ID
 */
async function generateMovementId() {
  const last = await StockMovement.findOne().sort({ createdAt: -1 }).select('movementId');
  let num = 1;
  if (last?.movementId) {
    const match = last.movementId.match(/MV-(\d+)/);
    if (match) num = parseInt(match[1]) + 1;
  }
  return `MV-${String(num).padStart(3, '0')}`;
}

/**
 * Consume materials during production
 * Deduct from reserved inventory
 */
export const consumeOEMMaterials = async (workOrderId) => {
  try {
    const workOrder = await WorkOrder.findById(workOrderId);
    if (!workOrder) {
      return { success: false, message: 'Work order not found' };
    }

    // Find linked OEM order
    const oemOrder = await OEMOrder.findOne({ workOrderId });
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    const consumedInventory = [];

    for (const reserved of oemOrder.reservedInventory) {
      const invItem = await InventoryItem.findById(reserved.inventoryId);
      if (!invItem) continue;

      // Update inventory
      invItem.reservedQuantity = Math.max(0, (invItem.reservedQuantity || 0) - reserved.qty);
      await invItem.save();

      // Record consumption
      consumedInventory.push({
        itemId: reserved.itemId,
        inventoryId: reserved.inventoryId,
        qty: reserved.qty,
        consumedAt: new Date()
      });

      // Create stock movement
      await StockMovement.create({
        movementId: await generateMovementId(),
        type: 'Consumed',
        sku: invItem.sku,
        name: invItem.name,
        qty: -reserved.qty,
        from: 'Reserved',
        to: 'Production',
        ref: workOrder.woId,
        remarks: `Consumed for Work Order: ${workOrder.woId}`
      });
    }

    // Update OEM order
    oemOrder.consumedInventory = consumedInventory;
    oemOrder.inventoryStatus = 'Consumed';
    oemOrder.productionStatus = 'In-Progress';
    await oemOrder.save();

    console.log(`✅ Materials consumed for Work Order: ${workOrder.woId}`);
    return {
      success: true,
      message: 'Materials consumed successfully',
      data: oemOrder
    };
  } catch (error) {
    console.error('❌ Material consumption failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Auto-generate Purchase Requisition for shortfall
 * When inventory validation fails
 */
export const autoGeneratePRForShortfall = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId).populate('bomId');
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    // Validate inventory first
    const validation = await validateOEMInventory(oemOrderId);
    if (validation.data.allAvailable) {
      return { success: false, message: 'All materials available, PR not needed' };
    }

    const shortfalls = validation.data.shortfalls;
    if (shortfalls.length === 0) {
      return { success: false, message: 'No shortfalls found' };
    }

    // Generate PR ID
    const lastPR = await PurchaseRequisition.findOne().sort({ createdAt: -1 }).select('prId');
    let prId;
    if (lastPR?.prId) {
      const match = lastPR.prId.match(/PR-(\d+)/);
      if (match) prId = `PR-${String(parseInt(match[1]) + 1).padStart(4, '0')}`;
    }
    if (!prId) prId = 'PR-0001';

    // Create PR items
    const prItems = shortfalls.map(shortfall => ({
      name: shortfall.materialName,
      qty: Math.ceil(shortfall.shortfallQty),
      unit: 'Nos',
      estimatedPrice: 0
    }));

    // Create PR
    const pr = await PurchaseRequisition.create({
      prId,
      items: prItems,
      status: 'Pending',
      priority: 'High',
      remarks: `Auto-generated for OEM Order: ${oemOrder.oemOrderId}`
    });

    // Link PR to OEM order
    oemOrder.linkedPRId = pr._id;
    await oemOrder.save();

    console.log(`✅ PR auto-generated for OEM Order: ${oemOrder.oemOrderId}`);
    return {
      success: true,
      message: 'Purchase requisition created for shortfall',
      data: pr
    };
  } catch (error) {
    console.error('❌ PR auto-generation failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Release reserved materials if order is cancelled
 */
export const releaseReservedMaterials = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId);
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    for (const reserved of oemOrder.reservedInventory) {
      const invItem = await InventoryItem.findById(reserved.inventoryId);
      if (!invItem) continue;

      // Release inventory
      invItem.qty += reserved.qty;
      invItem.reservedQuantity = Math.max(0, (invItem.reservedQuantity || 0) - reserved.qty);
      await invItem.save();

      // Create stock movement
      await StockMovement.create({
        movementId: await generateMovementId(),
        type: 'Released',
        sku: invItem.sku,
        name: invItem.name,
        qty: reserved.qty,
        from: 'Reserved',
        to: invItem.warehouse,
        ref: oemOrder.oemOrderId,
        remarks: `Released due to OEM Order cancellation: ${oemOrder.oemOrderId}`
      });
    }

    // Update OEM order
    oemOrder.reservedInventory = [];
    oemOrder.inventoryStatus = 'Pending';
    await oemOrder.save();

    console.log(`✅ Reserved materials released for OEM Order: ${oemOrder.oemOrderId}`);
    return {
      success: true,
      message: 'Reserved materials released',
      data: oemOrder
    };
  } catch (error) {
    console.error('❌ Material release failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Get inventory status for OEM order
 */
export const getOEMInventoryStatus = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId)
      .populate('bomId')
      .populate('reservedInventory.inventoryId');

    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    const bom = oemOrder.bomId;
    const materials = [];

    for (const component of bom.components) {
      const requiredQty = component.qty * (1 + (component.scrapFactor || 0) / 100) * oemOrder.quantity;
      
      // Find inventory items
      const invItems = await InventoryItem.find({
        $or: [
          { sku: component.itemCode || '' },
          { name: new RegExp(component.itemName, 'i') }
        ]
      });
      const availableQty = invItems.reduce((sum, item) => sum + (item.qty || 0), 0);
      const reservedQty = invItems.reduce((sum, item) => sum + (item.reservedQuantity || 0), 0);

      materials.push({
        materialId: component.itemMasterId,
        materialName: component.itemName,
        sku: component.itemCode,
        requiredQty: Math.round(requiredQty * 1000) / 1000,
        availableQty,
        reservedQty,
        consumedQty: oemOrder.consumedInventory.find(c => 
          c.itemId && component.itemMasterId && 
          c.itemId.toString() === component.itemMasterId.toString()
        )?.qty || 0,
        status: availableQty >= requiredQty ? 'Available' : 'Partial'
      });
    }

    return {
      success: true,
      data: {
        oemOrderId: oemOrder.oemOrderId,
        inventoryStatus: oemOrder.inventoryStatus,
        materials,
        summary: {
          totalMaterials: materials.length,
          availableMaterials: materials.filter(m => m.status === 'Available').length,
          partialMaterials: materials.filter(m => m.status === 'Partial').length
        }
      }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
};
