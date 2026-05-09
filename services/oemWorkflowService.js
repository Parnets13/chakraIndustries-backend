import OEMOrder from '../models/OEMOrder.js';
import WorkOrder from '../models/WorkOrder.js';
import OEMFinishedGoods from '../models/OEMFinishedGoods.js';
import OEMInvoice from '../models/OEMInvoice.js';
import QualityCheck from '../models/QualityCheck.js';
import BOM from '../models/BOM.js';

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
    const year = new Date().getFullYear();
    const count = await WorkOrder.countDocuments();
    const woId = `WO-${year}-${String(count + 1).padStart(5, '0')}`;

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

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

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
    oemOrder.workOrderId = workOrder._id;
    oemOrder.status = 'BOM-Loaded';
    oemOrder.productionStatus = 'Pending';
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
