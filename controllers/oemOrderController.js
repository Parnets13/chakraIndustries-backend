import OEMOrder from '../models/OEMOrder.js';
import BrandOrder from '../models/BrandOrder.js';
import BOM from '../models/BOM.js';
import WorkOrder from '../models/WorkOrder.js';
import Inventory from '../models/Inventory.js';
import {
  autoCreateWorkOrder,
  autoCreateQC,
  autoCreateFinishedGoods,
  autoCreateInvoice,
  completeOEMOrderWorkflow,
  getWorkflowStatus
} from '../services/oemWorkflowService.js';

// Generate unique OEM Order ID
const generateOEMOrderId = async () => {
  const count = await OEMOrder.countDocuments();
  return `OEM-${Date.now()}-${count + 1}`;
};

// Create OEM Order from Brand Order
export const createOEMOrder = async (req, res) => {
  try {
    const { brandOrderId, bomId } = req.body;

    // Verify brand order exists
    const brandOrder = await BrandOrder.findById(brandOrderId);
    if (!brandOrder) {
      return res.status(404).json({ success: false, message: 'Brand order not found' });
    }

    // Verify BOM exists
    const bom = await BOM.findById(bomId);
    if (!bom) {
      return res.status(404).json({ success: false, message: 'BOM not found' });
    }

    const oemOrderId = await generateOEMOrderId();

    // Extract materials from BOM
    const requiredMaterials = bom.materials.map(mat => ({
      materialId: mat.materialId,
      materialName: mat.materialName,
      sku: mat.sku,
      requiredQty: mat.quantity * brandOrder.quantity,
      unit: mat.unit,
      availableQty: mat.availableStock || 0,
      reservedQty: 0,
      consumedQty: 0,
      status: (mat.availableStock || 0) >= (mat.quantity * brandOrder.quantity) ? 'Available' : 'Partial'
    }));

    const oemOrder = new OEMOrder({
      oemOrderId,
      brandOrderId,
      product: brandOrder.product,
      quantity: brandOrder.quantity,
      unit: brandOrder.unit,
      bomId,
      requiredMaterials,
      estimatedCost: brandOrder.estimatedCost,
      createdBy: req.user?.id
    });

    await oemOrder.save();

    // Update brand order status
    await BrandOrder.findByIdAndUpdate(brandOrderId, { status: 'In-Production' });

    res.status(201).json({
      success: true,
      message: 'OEM order created successfully',
      data: oemOrder
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all OEM Orders
export const getOEMOrders = async (req, res) => {
  try {
    const { status, inventoryStatus, productionStatus } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (inventoryStatus) filter.inventoryStatus = inventoryStatus;
    if (productionStatus) filter.productionStatus = productionStatus;

    const oemOrders = await OEMOrder.find(filter)
      .populate('brandOrderId', 'brandOrderId product quantity')
      .populate('bomId', 'product materials')
      .populate('workOrderId', 'woId status')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: oemOrders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get OEM Order by ID
export const getOEMOrderById = async (req, res) => {
  try {
    const oemOrder = await OEMOrder.findById(req.params.id)
      .populate('brandOrderId')
      .populate('bomId')
      .populate('workOrderId')
      .populate('createdBy', 'name email');

    if (!oemOrder) {
      return res.status(404).json({ success: false, message: 'OEM order not found' });
    }

    res.json({ success: true, data: oemOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Validate Inventory
export const validateInventory = async (req, res) => {
  try {
    const { id } = req.params;

    const oemOrder = await OEMOrder.findById(id);
    if (!oemOrder) {
      return res.status(404).json({ success: false, message: 'OEM order not found' });
    }

    // Check inventory for all required materials
    let allAvailable = true;
    const updatedMaterials = [];

    for (const material of oemOrder.requiredMaterials) {
      const inventory = await Inventory.findOne({
        itemId: material.materialId,
        quantity: { $gte: material.requiredQty }
      });

      const status = inventory ? 'Available' : 'Partial';
      const availableQty = inventory ? inventory.quantity : 0;

      updatedMaterials.push({
        ...material,
        availableQty,
        status
      });

      if (!inventory) allAvailable = false;
    }

    oemOrder.requiredMaterials = updatedMaterials;
    oemOrder.inventoryStatus = allAvailable ? 'Validated' : 'Partial';
    await oemOrder.save();

    res.json({
      success: true,
      message: allAvailable ? 'All materials available' : 'Some materials unavailable',
      data: oemOrder
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Reserve Materials
export const reserveMaterials = async (req, res) => {
  try {
    const { id } = req.params;

    const oemOrder = await OEMOrder.findById(id);
    if (!oemOrder) {
      return res.status(404).json({ success: false, message: 'OEM order not found' });
    }

    const reservedInventory = [];

    for (const material of oemOrder.requiredMaterials) {
      const inventory = await Inventory.findOne({ itemId: material.materialId });

      if (inventory && inventory.quantity >= material.requiredQty) {
        inventory.quantity -= material.requiredQty;
        await inventory.save();

        reservedInventory.push({
          itemId: material.materialId,
          inventoryId: inventory._id,
          qty: material.requiredQty,
          reservedAt: new Date()
        });
      }
    }

    oemOrder.reservedInventory = reservedInventory;
    oemOrder.inventoryStatus = 'Reserved';
    oemOrder.status = 'Material-Reserved';
    await oemOrder.save();

    // AUTO-TRIGGER: Create Work Order
    const woResult = await autoCreateWorkOrder(id);

    res.json({
      success: true,
      message: 'Materials reserved successfully',
      data: oemOrder,
      autoTriggered: {
        workOrder: woResult
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update OEM Order Status
export const updateOEMOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const oemOrder = await OEMOrder.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!oemOrder) {
      return res.status(404).json({ success: false, message: 'OEM order not found' });
    }

    res.json({ success: true, message: 'OEM order status updated', data: oemOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get OEM Order Summary
export const getOEMOrderSummary = async (req, res) => {
  try {
    const summary = {
      totalOrders: await OEMOrder.countDocuments(),
      byStatus: await OEMOrder.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      byInventoryStatus: await OEMOrder.aggregate([
        { $group: { _id: '$inventoryStatus', count: { $sum: 1 } } }
      ]),
      byProductionStatus: await OEMOrder.aggregate([
        { $group: { _id: '$productionStatus', count: { $sum: 1 } } }
      ])
    };

    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Get Workflow Status
export const getOEMWorkflowStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await getWorkflowStatus(id);
    
    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Complete OEM Order Workflow
export const completeOEMWorkflow = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await completeOEMOrderWorkflow(id);
    
    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Manual trigger for auto-workflows
export const triggerAutoWorkflows = async (req, res) => {
  try {
    const { id } = req.params;
    const { workflow } = req.body; // 'workOrder', 'qc', 'finishedGoods', 'invoice'

    const oemOrder = await OEMOrder.findById(id);
    if (!oemOrder) {
      return res.status(404).json({ success: false, message: 'OEM order not found' });
    }

    let result;

    switch (workflow) {
      case 'workOrder':
        result = await autoCreateWorkOrder(id);
        break;
      case 'purchaseRequisition':
        result = await autoCreatePurchaseRequisition(id);
        break;
      case 'qc':
        if (oemOrder.workOrderId) {
          result = await autoCreateQC(oemOrder.workOrderId);
        } else {
          result = { success: false, message: 'No work order found' };
        }
        break;
      case 'finishedGoods':
        if (oemOrder.qcCheckId) {
          result = await autoCreateFinishedGoods(oemOrder.qcCheckId);
        } else {
          result = { success: false, message: 'No QC found' };
        }
        break;
      case 'invoice':
        result = await autoCreateInvoice(id);
        break;
      default:
        result = { success: false, message: 'Invalid workflow' };
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
