import BOM from '../models/BOM.js';
import WorkOrder from '../models/WorkOrder.js';
import {
  calculateRequiredMaterials,
  checkInventoryAvailability,
  reserveInventory,
  releaseReservedInventory,
  consumeInventory
} from '../services/bomCalculationService.js';

// Generate BOM ID
const generateBOMId = async () => {
  const year = new Date().getFullYear();
  const prefix = `BOM-${year}-`;
  const last = await BOM.findOne({ _id: { $exists: true } }).sort({ _id: -1 }).limit(1);
  if (!last) return `${prefix}001`;
  return `${prefix}${String(parseInt(prefix.split('-')[2]) + 1).padStart(3, '0')}`;
};

// Generate Work Order ID
const generateWOId = async () => {
  const year = new Date().getFullYear();
  const prefix = `WO-${year}-`;
  const last = await WorkOrder.findOne({ woId: new RegExp(`^${prefix}`) }).sort({ woId: -1 }).limit(1);
  if (!last) return `${prefix}001`;
  const lastNum = parseInt(last.woId.split('-')[2]) || 0;
  return `${prefix}${String(lastNum + 1).padStart(3, '0')}`;
};

// BOM CRUD
export const createBOM = async (req, res) => {
  try {
    const bom = new BOM(req.body);
    const saved = await bom.save();
    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getBOMs = async (req, res) => {
  try {
    const boms = await BOM.find().sort({ createdAt: -1 });
    res.json({ success: true, data: boms });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getBOMById = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateBOM = async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    const bom = await BOM.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    res.json({ success: true, data: bom });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteBOM = async (req, res) => {
  try {
    const bom = await BOM.findByIdAndDelete(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    res.json({ success: true, message: 'BOM deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Work Order CRUD
export const createWorkOrder = async (req, res) => {
  try {
    const woId = await generateWOId();
    const wo = new WorkOrder({ ...req.body, woId });
    const saved = await wo.save();
    const populated = await WorkOrder.findById(saved._id).populate('bom');
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * Calculate required materials for work order
 */
export const calculateMaterialRequirements = async (req, res) => {
  try {
    const { bomId, productionQty } = req.body;

    if (!bomId || !productionQty) {
      return res.status(400).json({ success: false, message: 'BOM ID and production quantity required' });
    }

    const requiredMaterials = await calculateRequiredMaterials(bomId, productionQty);
    const availability = await checkInventoryAvailability(requiredMaterials);

    res.json({
      success: true,
      data: {
        requiredMaterials: availability.materials,
        allAvailable: availability.allAvailable,
        totalShortfall: availability.totalShortfall
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * Check inventory availability for work order
 */
export const checkInventoryStatus = async (req, res) => {
  try {
    const { woId } = req.params;
    const wo = await WorkOrder.findById(woId).populate('bom');

    if (!wo) {
      return res.status(404).json({ success: false, message: 'Work Order not found' });
    }

    const requiredMaterials = await calculateRequiredMaterials(wo.bom._id, wo.qty);
    const availability = await checkInventoryAvailability(requiredMaterials);

    res.json({
      success: true,
      data: {
        woId: wo.woId,
        requiredMaterials: availability.materials,
        allAvailable: availability.allAvailable,
        totalShortfall: availability.totalShortfall,
        canApprove: availability.allAvailable
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * Approve work order with inventory reservation
 */
export const approveWorkOrder = async (req, res) => {
  try {
    const { woId } = req.params;
    const wo = await WorkOrder.findById(woId).populate('bom');

    if (!wo) {
      return res.status(404).json({ success: false, message: 'Work Order not found' });
    }

    // Calculate required materials
    const requiredMaterials = await calculateRequiredMaterials(wo.bom._id, wo.qty);
    const availability = await checkInventoryAvailability(requiredMaterials);

    // Check if all materials are available
    if (!availability.allAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient inventory for approval',
        data: {
          shortfallItems: availability.materials.filter(m => m.shortfall > 0)
        }
      });
    }

    // Reserve inventory
    const reservations = await reserveInventory(availability.materials);

    // Update work order
    const updated = await WorkOrder.findByIdAndUpdate(
      woId,
      {
        approvalStatus: 'Approved',
        requiredMaterials: availability.materials,
        inventoryStatus: 'Reserved',
        reservedInventory: reservations,
        updatedAt: new Date()
      },
      { new: true }
    ).populate('bom');

    res.json({
      success: true,
      message: 'Work Order approved and inventory reserved',
      data: updated
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * Reject work order
 */
export const rejectWorkOrder = async (req, res) => {
  try {
    const { woId } = req.params;
    const { reason } = req.body;

    const wo = await WorkOrder.findByIdAndUpdate(
      woId,
      {
        approvalStatus: 'Rejected',
        remarks: reason || 'Rejected by approver',
        updatedAt: new Date()
      },
      { new: true }
    ).populate('bom');

    res.json({
      success: true,
      message: 'Work Order rejected',
      data: wo
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * Complete work order and consume inventory
 */
export const completeWorkOrder = async (req, res) => {
  try {
    const { woId } = req.params;
    const { actualProduced } = req.body;

    const wo = await WorkOrder.findById(woId);

    if (!wo) {
      return res.status(404).json({ success: false, message: 'Work Order not found' });
    }

    if (wo.approvalStatus !== 'Approved') {
      return res.status(400).json({ success: false, message: 'Work Order must be approved before completion' });
    }

    // Consume inventory based on actual production
    const consumed = await consumeInventory(wo.reservedInventory, actualProduced, wo.qty);

    // Update work order
    const updated = await WorkOrder.findByIdAndUpdate(
      woId,
      {
        status: 'Completed',
        produced: actualProduced,
        inventoryStatus: 'Consumed',
        consumedInventory: consumed,
        endDate: new Date(),
        updatedAt: new Date()
      },
      { new: true }
    ).populate('bom');

    res.json({
      success: true,
      message: 'Work Order completed and inventory consumed',
      data: updated
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getWorkOrders = async (req, res) => {
  try {
    const workOrders = await WorkOrder.find().populate('bom').sort({ createdAt: -1 });
    res.json({ success: true, data: workOrders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getWorkOrderById = async (req, res) => {
  try {
    const wo = await WorkOrder.findById(req.params.id).populate('bom');
    if (!wo) return res.status(404).json({ success: false, message: 'Work Order not found' });
    res.json({ success: true, data: wo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateWorkOrder = async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    const wo = await WorkOrder.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).populate('bom');
    if (!wo) return res.status(404).json({ success: false, message: 'Work Order not found' });
    res.json({ success: true, data: wo });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateWorkOrderProgress = async (req, res) => {
  try {
    const { produced } = req.body;
    const wo = await WorkOrder.findByIdAndUpdate(
      req.params.id,
      { produced, updatedAt: new Date() },
      { new: true, runValidators: true }
    ).populate('bom');
    if (!wo) return res.status(404).json({ success: false, message: 'Work Order not found' });
    res.json({ success: true, data: wo });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteWorkOrder = async (req, res) => {
  try {
    const wo = await WorkOrder.findByIdAndDelete(req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Work Order not found' });
    res.json({ success: true, message: 'Work Order deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Production Stats
export const getProductionStats = async (req, res) => {
  try {
    const totalWOs = await WorkOrder.countDocuments();
    const completedWOs = await WorkOrder.countDocuments({ status: 'Completed' });
    const inProgressWOs = await WorkOrder.countDocuments({ status: 'In-Progress' });
    const scheduledWOs = await WorkOrder.countDocuments({ status: 'Scheduled' });
    const totalBOMs = await BOM.countDocuments();

    res.json({
      success: true,
      data: {
        totalWorkOrders: totalWOs,
        completedWorkOrders: completedWOs,
        inProgressWorkOrders: inProgressWOs,
        scheduledWorkOrders: scheduledWOs,
        totalBOMs
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
