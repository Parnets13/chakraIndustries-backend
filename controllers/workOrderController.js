import WorkOrder from '../models/WorkOrder.js';
import OEMOrder from '../models/OEMOrder.js';
import BOM from '../models/BOM.js';
import Inventory from '../models/Inventory.js';

// Generate unique Work Order ID
const generateWorkOrderId = async () => {
  const count = await WorkOrder.countDocuments();
  return `WO-${Date.now()}-${count + 1}`;
};

// Auto-create Work Order from OEM Order
export const createWorkOrderFromOEM = async (req, res) => {
  try {
    const { oemOrderId } = req.body;

    // Verify OEM order exists
    const oemOrder = await OEMOrder.findById(oemOrderId).populate('bomId');
    if (!oemOrder) {
      return res.status(404).json({ success: false, message: 'OEM order not found' });
    }

    // Verify BOM exists
    const bom = await BOM.findById(oemOrder.bomId);
    if (!bom) {
      return res.status(404).json({ success: false, message: 'BOM not found' });
    }

    const woId = await generateWorkOrderId();
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days default

    // Extract materials from BOM
    const requiredMaterials = bom.materials.map(mat => ({
      itemId: mat.materialId,
      itemName: mat.materialName,
      sku: mat.sku,
      requiredQty: mat.quantity * oemOrder.quantity,
      unit: mat.unit,
      availableQty: mat.availableStock || 0,
      shortfall: Math.max(0, (mat.quantity * oemOrder.quantity) - (mat.availableStock || 0)),
      status: (mat.availableStock || 0) >= (mat.quantity * oemOrder.quantity) ? 'Available' : 'Partial'
    }));

    const workOrder = new WorkOrder({
      woId,
      product: bom.product,
      qty: oemOrder.quantity,
      bom: oemOrder.bomId,
      startDate,
      endDate,
      priority: 'Normal',
      status: 'Scheduled',
      approvalStatus: 'Pending',
      requiredMaterials,
      inventoryStatus: 'Pending',
      remarks: `Auto-generated from OEM Order: ${oemOrder.oemOrderId}`
    });

    await workOrder.save();

    // Update OEM order with work order reference
    await OEMOrder.findByIdAndUpdate(oemOrderId, {
      workOrderId: workOrder._id,
      status: 'BOM-Loaded'
    });

    res.status(201).json({
      success: true,
      message: 'Work order created successfully from OEM order',
      data: workOrder
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create Work Order manually
export const createWorkOrder = async (req, res) => {
  try {
    const { product, qty, bomId, shift, priority, startDate, endDate, remarks } = req.body;

    // Verify BOM exists
    const bom = await BOM.findById(bomId);
    if (!bom) {
      return res.status(404).json({ success: false, message: 'BOM not found' });
    }

    const woId = await generateWorkOrderId();

    // Extract materials from BOM
    const requiredMaterials = bom.materials.map(mat => ({
      itemId: mat.materialId,
      itemName: mat.materialName,
      sku: mat.sku,
      requiredQty: mat.quantity * qty,
      unit: mat.unit,
      availableQty: mat.availableStock || 0,
      shortfall: Math.max(0, (mat.quantity * qty) - (mat.availableStock || 0)),
      status: (mat.availableStock || 0) >= (mat.quantity * qty) ? 'Available' : 'Partial'
    }));

    const workOrder = new WorkOrder({
      woId,
      product,
      qty,
      bom: bomId,
      shift: shift || 'Morning',
      priority: priority || 'Normal',
      startDate: startDate || new Date(),
      endDate: endDate || new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000),
      requiredMaterials,
      remarks
    });

    await workOrder.save();

    res.status(201).json({
      success: true,
      message: 'Work order created successfully',
      data: workOrder
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all Work Orders
export const getWorkOrders = async (req, res) => {
  try {
    const { status, approvalStatus, priority } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (approvalStatus) filter.approvalStatus = approvalStatus;
    if (priority) filter.priority = priority;

    const workOrders = await WorkOrder.find(filter)
      .populate('bom', 'product materials')
      .sort({ startDate: -1 });

    res.json({ success: true, data: workOrders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Work Order by ID
export const getWorkOrderById = async (req, res) => {
  try {
    const workOrder = await WorkOrder.findById(req.params.id)
      .populate('bom', 'product materials');

    if (!workOrder) {
      return res.status(404).json({ success: false, message: 'Work order not found' });
    }

    res.json({ success: true, data: workOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Approve Work Order
export const approveWorkOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const workOrder = await WorkOrder.findByIdAndUpdate(
      id,
      { approvalStatus: 'Approved', status: 'Scheduled' },
      { new: true }
    );

    if (!workOrder) {
      return res.status(404).json({ success: false, message: 'Work order not found' });
    }

    res.json({ success: true, message: 'Work order approved', data: workOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Validate Inventory for Work Order
export const validateInventory = async (req, res) => {
  try {
    const { id } = req.params;

    const workOrder = await WorkOrder.findById(id);
    if (!workOrder) {
      return res.status(404).json({ success: false, message: 'Work order not found' });
    }

    // Check inventory for all required materials
    let allAvailable = true;
    const updatedMaterials = [];

    for (const material of workOrder.requiredMaterials) {
      const inventory = await Inventory.findOne({
        itemId: material.itemId,
        quantity: { $gte: material.requiredQty }
      });

      const status = inventory ? 'Available' : 'Partial';
      const availableQty = inventory ? inventory.quantity : 0;
      const shortfall = Math.max(0, material.requiredQty - availableQty);

      updatedMaterials.push({
        ...material,
        availableQty,
        shortfall,
        status
      });

      if (!inventory) allAvailable = false;
    }

    workOrder.requiredMaterials = updatedMaterials;
    workOrder.inventoryStatus = allAvailable ? 'Reserved' : 'Partial';
    await workOrder.save();

    res.json({
      success: true,
      message: allAvailable ? 'All materials available' : 'Some materials unavailable',
      data: workOrder
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Reserve Materials for Work Order
export const reserveMaterials = async (req, res) => {
  try {
    const { id } = req.params;

    const workOrder = await WorkOrder.findById(id);
    if (!workOrder) {
      return res.status(404).json({ success: false, message: 'Work order not found' });
    }

    const reservedInventory = [];

    for (const material of workOrder.requiredMaterials) {
      const inventory = await Inventory.findOne({ itemId: material.itemId });

      if (inventory && inventory.quantity >= material.requiredQty) {
        inventory.quantity -= material.requiredQty;
        await inventory.save();

        reservedInventory.push({
          itemId: material.itemId,
          inventoryId: inventory._id,
          qty: material.requiredQty,
          reservedAt: new Date()
        });
      }
    }

    workOrder.reservedInventory = reservedInventory;
    workOrder.inventoryStatus = 'Reserved';
    workOrder.status = 'Scheduled';
    await workOrder.save();

    res.json({
      success: true,
      message: 'Materials reserved successfully',
      data: workOrder
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Start Production
export const startProduction = async (req, res) => {
  try {
    const { id } = req.params;

    const workOrder = await WorkOrder.findByIdAndUpdate(
      id,
      { status: 'In-Progress' },
      { new: true }
    );

    if (!workOrder) {
      return res.status(404).json({ success: false, message: 'Work order not found' });
    }

    res.json({ success: true, message: 'Production started', data: workOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Production Quantity
export const updateProducedQty = async (req, res) => {
  try {
    const { id } = req.params;
    const { produced } = req.body;

    const workOrder = await WorkOrder.findById(id);
    if (!workOrder) {
      return res.status(404).json({ success: false, message: 'Work order not found' });
    }

    if (produced > workOrder.qty) {
      return res.status(400).json({ success: false, message: 'Produced quantity cannot exceed required quantity' });
    }

    workOrder.produced = produced;

    // Auto-complete if all produced
    if (produced === workOrder.qty) {
      workOrder.status = 'Completed';
      workOrder.endDate = new Date();
    }

    await workOrder.save();

    res.json({ success: true, message: 'Production quantity updated', data: workOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Complete Work Order
export const completeWorkOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const workOrder = await WorkOrder.findByIdAndUpdate(
      id,
      { status: 'Completed', endDate: new Date() },
      { new: true }
    );

    if (!workOrder) {
      return res.status(404).json({ success: false, message: 'Work order not found' });
    }

    res.json({ success: true, message: 'Work order completed', data: workOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Hold Work Order
export const holdWorkOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;

    const workOrder = await WorkOrder.findByIdAndUpdate(
      id,
      { status: 'On-Hold', remarks },
      { new: true }
    );

    if (!workOrder) {
      return res.status(404).json({ success: false, message: 'Work order not found' });
    }

    res.json({ success: true, message: 'Work order on hold', data: workOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Cancel Work Order
export const cancelWorkOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const workOrder = await WorkOrder.findByIdAndUpdate(
      id,
      { status: 'Cancelled' },
      { new: true }
    );

    if (!workOrder) {
      return res.status(404).json({ success: false, message: 'Work order not found' });
    }

    res.json({ success: true, message: 'Work order cancelled', data: workOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Work Order Summary
export const getWorkOrderSummary = async (req, res) => {
  try {
    const summary = {
      totalWorkOrders: await WorkOrder.countDocuments(),
      byStatus: await WorkOrder.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      byApprovalStatus: await WorkOrder.aggregate([
        { $group: { _id: '$approvalStatus', count: { $sum: 1 } } }
      ]),
      byPriority: await WorkOrder.aggregate([
        { $group: { _id: '$priority', count: { $sum: 1 } } }
      ]),
      totalQtyRequired: await WorkOrder.aggregate([
        { $group: { _id: null, total: { $sum: '$qty' } } }
      ]),
      totalQtyProduced: await WorkOrder.aggregate([
        { $group: { _id: null, total: { $sum: '$produced' } } }
      ])
    };

    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Consume Materials
export const consumeMaterials = async (req, res) => {
  try {
    const { id } = req.params;

    const workOrder = await WorkOrder.findById(id);
    if (!workOrder) {
      return res.status(404).json({ success: false, message: 'Work order not found' });
    }

    const consumedInventory = [];

    for (const reserved of workOrder.reservedInventory) {
      consumedInventory.push({
        itemId: reserved.itemId,
        inventoryId: reserved.inventoryId,
        qty: reserved.qty,
        consumedAt: new Date()
      });
    }

    workOrder.consumedInventory = consumedInventory;
    workOrder.inventoryStatus = 'Consumed';
    await workOrder.save();

    res.json({
      success: true,
      message: 'Materials consumed successfully',
      data: workOrder
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
