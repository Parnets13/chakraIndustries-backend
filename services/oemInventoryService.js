import OEMOrder from '../models/OEMOrder.js';
import Inventory from '../models/Inventory.js';
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

    for (const material of bom.materials) {
      const inventory = await Inventory.findOne({
        itemId: material.materialId
      });

      const requiredQty = material.quantity * oemOrder.quantity;
      const availableQty = inventory?.quantity || 0;
      const isAvailable = availableQty >= requiredQty;

      validationResult.materials.push({
        materialId: material.materialId,
        materialName: material.materialName,
        sku: material.sku,
        requiredQty,
        availableQty,
        isAvailable,
        shortfall: Math.max(0, requiredQty - availableQty)
      });

      if (!isAvailable) {
        validationResult.allAvailable = false;
        validationResult.shortfalls.push({
          materialId: material.materialId,
          materialName: material.materialName,
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

    for (const material of bom.materials) {
      const requiredQty = material.quantity * oemOrder.quantity;
      const inventory = await Inventory.findOne({
        itemId: material.materialId
      });

      if (!inventory || inventory.quantity < requiredQty) {
        failedReservations.push({
          materialId: material.materialId,
          materialName: material.materialName,
          required: requiredQty,
          available: inventory?.quantity || 0
        });
        continue;
      }

      // Deduct from inventory
      inventory.quantity -= requiredQty;
      inventory.reserved = (inventory.reserved || 0) + requiredQty;
      await inventory.save();

      // Record reservation
      reservedInventory.push({
        itemId: material.materialId,
        inventoryId: inventory._id,
        qty: requiredQty,
        reservedAt: new Date()
      });

      // Create stock movement
      await StockMovement.create({
        itemId: material.materialId,
        movementType: 'Reserved',
        quantity: requiredQty,
        fromLocation: inventory.location,
        toLocation: 'Reserved',
        reference: oemOrder.oemOrderId,
        referenceType: 'OEMOrder',
        remarks: `Reserved for OEM Order: ${oemOrder.oemOrderId}`
      });
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
      const inventory = await Inventory.findById(reserved.inventoryId);
      if (!inventory) continue;

      // Update inventory
      inventory.reserved = Math.max(0, (inventory.reserved || 0) - reserved.qty);
      inventory.consumed = (inventory.consumed || 0) + reserved.qty;
      await inventory.save();

      // Record consumption
      consumedInventory.push({
        itemId: reserved.itemId,
        inventoryId: reserved.inventoryId,
        qty: reserved.qty,
        consumedAt: new Date()
      });

      // Create stock movement
      await StockMovement.create({
        itemId: reserved.itemId,
        movementType: 'Consumed',
        quantity: reserved.qty,
        fromLocation: 'Reserved',
        toLocation: 'Production',
        reference: workOrder.woId,
        referenceType: 'WorkOrder',
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
    const year = new Date().getFullYear();
    const count = await PurchaseRequisition.countDocuments();
    const prId = `PR-${year}-${String(count + 1).padStart(5, '0')}`;

    // Create PR items
    const prItems = shortfalls.map(shortfall => ({
      itemId: shortfall.materialId,
      itemName: shortfall.materialName,
      quantity: shortfall.shortfallQty,
      unit: 'Pcs',
      estimatedCost: 0,
      remarks: `Auto-generated for OEM Order: ${oemOrder.oemOrderId}`
    }));

    // Create PR
    const pr = await PurchaseRequisition.create({
      prId,
      items: prItems,
      status: 'Pending',
      approvalStatus: 'Pending',
      priority: 'High',
      requiredDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
      remarks: `Auto-generated for OEM Order: ${oemOrder.oemOrderId}`,
      linkedOEMOrder: oemOrder._id
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
      const inventory = await Inventory.findById(reserved.inventoryId);
      if (!inventory) continue;

      // Release inventory
      inventory.quantity += reserved.qty;
      inventory.reserved = Math.max(0, (inventory.reserved || 0) - reserved.qty);
      await inventory.save();

      // Create stock movement
      await StockMovement.create({
        itemId: reserved.itemId,
        movementType: 'Released',
        quantity: reserved.qty,
        fromLocation: 'Reserved',
        toLocation: inventory.location,
        reference: oemOrder.oemOrderId,
        referenceType: 'OEMOrder',
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

    for (const material of bom.materials) {
      const inventory = await Inventory.findOne({
        itemId: material.materialId
      });

      const requiredQty = material.quantity * oemOrder.quantity;
      const availableQty = inventory?.quantity || 0;
      const reservedQty = inventory?.reserved || 0;

      materials.push({
        materialId: material.materialId,
        materialName: material.materialName,
        sku: material.sku,
        requiredQty,
        availableQty,
        reservedQty,
        consumedQty: oemOrder.consumedInventory.find(c => c.itemId.toString() === material.materialId.toString())?.qty || 0,
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
