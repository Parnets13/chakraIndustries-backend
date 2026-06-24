import OEMOrder from '../models/OEMOrder.js';
import WorkOrder from '../models/WorkOrder.js';
import OEMFinishedGoods from '../models/OEMFinishedGoods.js';
import OEMInvoice from '../models/OEMInvoice.js';
import QualityCheck from '../models/QualityCheck.js';
import BOM from '../models/BOM.js';
import InventoryItem from '../models/InventoryItem.js';

// Auto-create Work Order when materials are reserved
export const autoCreateWorkOrder = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId).populate('bomId');
    
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    // Check if work order already exists
    if (oemOrder.workOrderId) {
      return { success: false, message: 'Work order already exists' };
    }

    const bom = await BOM.findById(oemOrder.bomId);
    if (!bom) {
      return { success: false, message: 'BOM not found' };
    }

    // Generate Work Order ID
    const lastWO = await WorkOrder.findOne().sort({ createdAt: -1 }).select('woId');
    let woId;
    if (lastWO?.woId) {
      const match = lastWO.woId.match(/WO-(\d+)/);
      if (match) {
        const num = parseInt(match[1]) + 1;
        woId = `WO-${String(num).padStart(4, '0')}`;
      }
    }
    if (!woId) {
      woId = 'WO-0001';
    }

    // Extract materials from BOM components
    const requiredMaterials = await Promise.all(bom.components.map(async (comp) => {
      const requiredQty = comp.qty * (1 + (comp.scrapFactor || 0) / 100) * oemOrder.quantity;
      
      // Find available stock for this component
      const invItems = await InventoryItem.find({
        $or: [
          { sku: comp.itemCode || '' },
          { name: new RegExp(comp.itemName, 'i') }
        ]
      });
      const availableQty = invItems.reduce((sum, item) => sum + (item.qty || 0), 0);
      
      return {
        itemId: comp.itemMasterId,
        itemName: comp.itemName,
        sku: comp.itemCode,
        requiredQty: Math.round(requiredQty * 1000) / 1000,
        unit: comp.unit,
        availableQty,
        shortfall: Math.max(0, requiredQty - availableQty),
        status: availableQty >= requiredQty ? 'Available' : 'Partial'
      };
    }));

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Create material consumption plan from BOM
    const materialConsumption = bom.components.map(comp => ({
      itemMasterId: comp.itemMasterId,
      itemName: comp.itemName,
      itemCode: comp.itemCode,
      plannedQty: Math.round(comp.qty * (1 + (comp.scrapFactor || 0) / 100) * oemOrder.quantity * 1000) / 1000,
      consumedQty: 0,
      unit: comp.unit,
      vendorId: comp.vendorId,
      oemBrand: comp.oemBrand,
      unitCost: comp.unitCost || 0
    }));

    // Calculate estimated cost
    let plannedCost = 0;
    for (const comp of bom.components) {
      const qty = comp.qty * (1 + (comp.scrapFactor || 0) / 100) * oemOrder.quantity;
      plannedCost += qty * (comp.unitCost || 0);
    }
    plannedCost = plannedCost * (1 + (bom.overheadPct || 0) / 100) + (bom.labourCost || 0) * oemOrder.quantity;

    const workOrder = new WorkOrder({
      woId,
      productItemMasterId: bom.productItemMasterId,
      product: bom.product,
      qty: oemOrder.quantity,
      bomId: oemOrder.bomId,
      oemBrand: oemOrder.oemBrand,
      oemProduct: null,
      salesOrderId: null,
      startDate,
      endDate,
      priority: 'Normal',
      status: 'Pending',
      materialConsumption,
      inventoryDeducted: false,
      plannedCost,
      remarks: `Auto-generated from OEM Order: ${oemOrder.oemOrderId}`
    });

    await workOrder.save();

    // Update OEM order with work order reference
    oemOrder.workOrderId = workOrder._id;
    oemOrder.status = 'BOM-Loaded';
    oemOrder.productionStatus = 'Pending';
    oemOrder.requiredMaterials = requiredMaterials;
    oemOrder.estimatedCost = plannedCost;
    await oemOrder.save();

    console.log(`✅ Work Order created: ${woId} for OEM Order: ${oemOrder.oemOrderId}`);
    return { success: true, message: 'Work order created successfully', data: workOrder };
  } catch (error) {
    console.error('❌ Work Order creation failed:', error.message);
    return { success: false, message: error.message };
  }
};

// Auto-create QC when production completes
export const autoCreateQC = async (workOrderId) => {
  try {
    const workOrder = await WorkOrder.findById(workOrderId);
    
    if (!workOrder || workOrder.status !== 'Completed') {
      return { success: false, message: 'Work order not completed' };
    }

    // Find linked OEM order
    const oemOrder = await OEMOrder.findOne({ workOrderId });
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    // Check if QC already exists
    if (oemOrder.qcCheckId) {
      return { success: false, message: 'QC already exists' };
    }

    const qcId = `QC-${Date.now()}`;
    const qc = new QualityCheck({
      qcId,
      grnId: null,
      items: [{
        itemName: workOrder.product,
        receivedQty: workOrder.qty,
        passedQty: 0,
        failedQty: 0,
        remarks: `Auto-generated for Work Order: ${workOrder.woId}`
      }],
      status: 'Pending',
      remarks: `Auto-generated for Work Order: ${workOrder.woId}`
    });

    await qc.save();

    // Update OEM order
    oemOrder.qcCheckId = qc._id;
    oemOrder.qcStatus = 'Pending';
    oemOrder.status = 'QC-Pending';
    await oemOrder.save();

    console.log(`✅ QC created: ${qcId} for Work Order: ${workOrder.woId}`);
    return { success: true, message: 'QC created successfully', data: qc };
  } catch (error) {
    console.error('❌ QC creation failed:', error.message);
    return { success: false, message: error.message };
  }
};

// Auto-create Finished Goods when QC passes
export const autoCreateFinishedGoods = async (qcCheckId) => {
  try {
    const qc = await QualityCheck.findById(qcCheckId);
    
    if (!qc || qc.status !== 'Passed') {
      return { success: false, message: 'QC not passed' };
    }

    // Find linked OEM order
    const oemOrder = await OEMOrder.findOne({ qcCheckId });
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    // Check if FG already exists
    if (oemOrder.finishedGoodsId) {
      return { success: false, message: 'Finished goods already created' };
    }

    const fgId = `FG-${Date.now()}`;
    const fg = new OEMFinishedGoods({
      finishedGoodsId: fgId,
      oemOrderId: oemOrder._id,
      product: oemOrder.product,
      quantity: oemOrder.quantity,
      unit: oemOrder.unit,
      batchNumber: `BATCH-${Date.now()}`,
      qcCheckId: qc._id,
      qcStatus: 'Passed',
      defectCount: 0,
      productionDate: new Date(),
      qcDate: new Date(),
      storageLocation: {
        warehouseId: null,
        locationId: null,
        binNumber: 'DEFAULT'
      },
      status: 'In-Storage',
      remarks: `Auto-created from QC: ${qc.qcId}`
    });

    await fg.save();

    // Update OEM order
    oemOrder.finishedGoodsId = fg._id;
    oemOrder.status = 'Finished-Goods';
    oemOrder.qcStatus = 'Passed';
    await oemOrder.save();

    console.log(`✅ Finished Goods created: ${fgId} for OEM Order: ${oemOrder.oemOrderId}`);
    return { success: true, message: 'Finished goods created', data: fg };
  } catch (error) {
    console.error('❌ Finished Goods creation failed:', error.message);
    return { success: false, message: error.message };
  }
};

// Auto-create Invoice when goods are dispatched
export const autoCreateInvoice = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId).populate('brandOrderId');
    
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    // Check if invoice already exists
    if (oemOrder.invoiceNumber) {
      return { success: false, message: 'Invoice already created' };
    }

    const invoiceNumber = `INV-${Date.now()}`;
    const amount = oemOrder.actualCost || oemOrder.estimatedCost || 0;
    const taxRate = 18;
    const taxAmount = (amount * taxRate) / 100;
    const totalAmount = amount + taxAmount;

    const invoice = new OEMInvoice({
      invoiceNumber,
      oemOrderId: oemOrder._id,
      brandOrderId: oemOrder.brandOrderId?._id,
      corporateClientId: oemOrder.brandOrderId?.corporateClientId,
      product: oemOrder.product,
      quantity: oemOrder.quantity,
      unit: oemOrder.unit,
      unitPrice: amount / oemOrder.quantity,
      subtotal: amount,
      taxRate,
      taxAmount,
      totalAmount,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      paymentStatus: 'Pending',
      paymentTerms: 'Net 30'
    });

    await invoice.save();

    // Update OEM order
    oemOrder.invoiceNumber = invoiceNumber;
    oemOrder.invoiceDate = new Date();
    oemOrder.invoiceAmount = totalAmount;
    oemOrder.billingStatus = 'Invoiced';
    oemOrder.status = 'Invoiced';
    await oemOrder.save();

    console.log(`✅ Invoice created: ${invoiceNumber} for OEM Order: ${oemOrder.oemOrderId}`);
    return { success: true, message: 'Invoice created', data: invoice };
  } catch (error) {
    console.error('❌ Invoice creation failed:', error.message);
    return { success: false, message: error.message };
  }
};

// Complete OEM Order workflow
export const completeOEMOrderWorkflow = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId);
    
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    // Update status to completed
    oemOrder.status = 'Completed';
    oemOrder.tallyStatus = 'Pending';
    await oemOrder.save();

    console.log(`✅ OEM Order workflow completed: ${oemOrder.oemOrderId}`);
    return { success: true, message: 'OEM order workflow completed', data: oemOrder };
  } catch (error) {
    console.error('❌ Workflow completion failed:', error.message);
    return { success: false, message: error.message };
  }
};

// Get workflow status
export const getWorkflowStatus = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId)
      .populate('workOrderId')
      .populate('qcCheckId')
      .populate('finishedGoodsId');

    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    const status = {
      oemOrder: {
        id: oemOrder._id,
        oemOrderId: oemOrder.oemOrderId,
        status: oemOrder.status,
        inventoryStatus: oemOrder.inventoryStatus,
        productionStatus: oemOrder.productionStatus,
        qcStatus: oemOrder.qcStatus,
        dispatchStatus: oemOrder.dispatchStatus,
        billingStatus: oemOrder.billingStatus,
        tallyStatus: oemOrder.tallyStatus
      },
      workOrder: oemOrder.workOrderId ? {
        id: oemOrder.workOrderId._id,
        woId: oemOrder.workOrderId.woId,
        status: oemOrder.workOrderId.status
      } : null,
      qc: oemOrder.qcCheckId ? {
        id: oemOrder.qcCheckId._id,
        qcId: oemOrder.qcCheckId.qcId,
        status: oemOrder.qcCheckId.status
      } : null,
      finishedGoods: oemOrder.finishedGoodsId ? {
        id: oemOrder.finishedGoodsId._id,
        finishedGoodsId: oemOrder.finishedGoodsId.finishedGoodsId,
        status: oemOrder.finishedGoodsId.status
      } : null,
      invoice: oemOrder.invoiceNumber ? {
        invoiceNumber: oemOrder.invoiceNumber,
        billingStatus: oemOrder.billingStatus
      } : null
    };

    return { success: true, data: status };
  } catch (error) {
    return { success: false, message: error.message };
  }
};
