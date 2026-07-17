import MaterialReturn from '../models/MaterialReturn.js';
import Invoice from '../models/Invoice.js';
import LossTracking from '../models/LossTracking.js';
import Inventory from '../models/Inventory.js';
import StockMovement from '../models/StockMovement.js';
import CreditNote from '../models/CreditNote.js';
import DocketTracking from '../models/DocketTracking.js';
import WarehouseGateEntry from '../models/WarehouseGateEntry.js';
import WarehouseVerification from '../models/WarehouseVerification.js';
import ReturnQC from '../models/ReturnQC.js';

const genId = async (prefix, field) => {
  // Timestamp-based unique ID — collision-proof even under concurrent requests.
  // Format: PREFIX-YEAR-XXXXXX (6 hex chars from timestamp + random)
  const year = new Date().getFullYear();
  const ts   = Date.now().toString(16).slice(-5).toUpperCase(); // 5 hex chars of timestamp
  const rand = Math.random().toString(16).slice(2, 4).toUpperCase(); // 2 random hex chars
  const id   = `${prefix}-${year}-${ts}${rand}`;

  // Sanity check: if somehow already exists, add extra random
  const exists = await MaterialReturn.findOne({ [field]: id }).lean();
  if (exists) {
    return `${prefix}-${year}-${Date.now().toString(16).toUpperCase()}`;
  }
  return id;
};

const toDateOrUndefined = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const buildInvoiceReturnContext = (invoice) => {
  if (!invoice) return null;
  const firstItem = invoice.items?.[0] || {};
  const productName = firstItem.description || invoice.biPartNumber || invoice.brandName || '';
  const returnQty = Number(firstItem.qty || invoice.totalQuantity || 1);
  const unitPrice = Number(firstItem.rate || (returnQty ? invoice.grandTotal / returnQty : 0) || 0);

  return {
    invoiceNo: invoice.invoiceNo,
    invoiceDate: invoice.invoiceDate,
    dispatchDate: toDateOrUndefined(invoice.dispatchDate),
    deliveryDate: toDateOrUndefined(invoice.deliveryDate),
    orderNo: invoice.purchaseOrderRef || invoice.uniqueId || '',
    customerName: invoice.partyName,
    supplierName: invoice.partyName,
    email: invoice.partyEmail || '',
    pinCode: invoice.partyPostal || '',
    gstNumber: invoice.partyGST || '',
    mobileNumber: invoice.partyPhone || '',
    pickupAddress: invoice.partyAddress || '',
    productName,
    skuCode: invoice.biPartNumber || firstItem.hsn || '',
    productSku: invoice.biPartNumber || firstItem.hsn || '',
    returnQty,
    expectedQty: returnQty,
    unitPrice,
    gstAmount: Number(firstItem.taxAmount || invoice.totalTax || 0),
    value: Number(firstItem.total || invoice.grandTotal || 0),
    awbNo: invoice.awb || '',
    transport: invoice.courierName || invoice.modeOfTransport || '',
  };
};

// 1. GET ALL RETURNS
export const getAll = async (req, res) => {
  try {
    const { stage, search } = req.query;
    const filter = {};
    if (stage) filter.currentStage = stage;
    if (search) {
      filter.$or = [
        { mrId: new RegExp(search, 'i') },
        { customerName: new RegExp(search, 'i') },
        { invoiceNo: new RegExp(search, 'i') },
        { docketId: new RegExp(search, 'i') }
      ];
    }
    const list = await MaterialReturn.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 2. GET DASHBOARD STATS
export const getStats = async (req, res) => {
  try {
    const total = await MaterialReturn.countDocuments();
    const inTransit = await MaterialReturn.countDocuments({ currentStage: 'IN_TRANSIT' });
    const pendingQC = await MaterialReturn.countDocuments({ currentStage: 'QC_PENDING' });
    const pendingFinance = await MaterialReturn.countDocuments({ currentStage: 'FINANCE_PENDING' });
    const closed = await MaterialReturn.countDocuments({ currentStage: 'CLOSED' });
    
    // Calculate values
    const stats = await MaterialReturn.aggregate([
      { $group: {
        _id: null,
        totalValue: { $sum: '$value' },
        lossValue: { $sum: '$lossAmount' }
      }}
    ]);

    res.json({ 
      success: true, 
      data: { 
        total, 
        inTransit, 
        pendingQC, 
        pendingFinance, 
        closed,
        returnValue: stats[0]?.totalValue || 0,
        lossValue: stats[0]?.lossValue || 0
      } 
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 3. GET INVOICE CONTEXT
export const getInvoiceContext = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNo: req.params.invoiceNo });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: buildInvoiceReturnContext(invoice) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 1. CREATE RETURN REQUEST
export const create = async (req, res) => {
  try {
    const body = req.body || {};
    
    // Auto Generate MR ID
    const mrId = await genId('MR', 'mrId');
    
    const mrData = {
      ...body,
      mrId,
      returnId: mrId, // Link both for flexibility
      currentStage: body.status === 'Approved' ? 'DOCKET_CREATED' : 'REQUEST_RAISED',
      approvalStatus: body.status || 'Pending',
      requestedBy: req.user?.name || 'User',
      stageTimeline: [{
        stage: 'REQUEST_RAISED',
        user: req.user?.name || 'User',
        remarks: 'Return request initiated',
        status: 'Completed'
      }]
    };

    // If already approved, add docket and approval timeline
    if (body.status === 'Approved') {
      mrData.docketId = await genId('DKT', 'docketId');
      mrData.approvedBy = req.user?.name || 'System';
      mrData.stageTimeline.push({
        stage: 'APPROVED',
        user: req.user?.name || 'System',
        remarks: 'Directly created as Approved',
        status: 'Completed'
      });
      mrData.stageTimeline.push({
        stage: 'DOCKET_CREATED',
        user: 'System',
        remarks: `Docket ${mrData.docketId} auto-generated`,
        status: 'Completed'
      });
    }

    const mr = await MaterialReturn.create(mrData);
    res.status(201).json({ success: true, data: mr });
  } catch (err) {
    console.error('Create Return Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// 5. APPROVE RETURN (Auto Create Docket)
export const approveReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    mr.approvalStatus = 'Approved';
    mr.approvedBy = req.user?.name || 'Manager';
    
    // Auto Generate Docket ID
    if (!mr.docketId || mr.docketId === 'PENDING') {
      mr.docketId = await genId('DKT', 'docketId');
    }

    // Set Initial Tracking Status
    mr.currentStage = 'DOCKET_CREATED';
    mr.trackingStatus = 'Pending Vehicle Assignment';

    mr.stageTimeline.push({
      stage: 'APPROVED',
      user: req.user?.name || 'Manager',
      remarks: 'Return request approved by manager. Docket auto-generated.',
      status: 'Completed'
    });

    mr.stageTimeline.push({
      stage: 'DOCKET_CREATED',
      user: 'System',
      remarks: `Docket ${mr.docketId} created. Waiting for logistics team to assign vehicle.`,
      status: 'Completed'
    });

    try {
      await mr.save();
      res.json({ success: true, data: mr });
    } catch (saveError) {
      console.error('Save Error in approveReturn:', saveError);
      res.status(400).json({ success: false, message: `Validation Error: ${saveError.message}` });
    }
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 6. GENERATE DOCKET (Manual trigger if needed)
export const generateDocket = async (req, res) => {
  try {
    const { id } = req.params;
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    const docketId = await genId('DKT', 'docketId');
    mr.docketId = docketId;

    await DocketTracking.create({
      docketId,
      mrId: mr.mrId,
      returnRequestId: mr.returnRequestId,
      awbLrNumber: req.body.awbNo || `LR-${Date.now()}`,
      courierPartner: req.body.transport || 'Other',
      vehicleNumber: req.body.vehicleNo || mr.vehicleNo || 'TBD',
      driverName: req.body.driverName || mr.driverName || 'TBD',
      driverMobile: req.body.driverMobile || mr.driverMobile || 'TBD',
      pickupLocation: mr.pickupAddress || 'TBD',
      deliveryLocation: mr.warehouseName || 'TBD',
      dispatchDate: new Date(),
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      shipmentWeight: req.body.weight || 0,
      transportCost: req.body.cost || 0,
      createdBy: req.user?.name || 'System',
      transportStatus: 'pickup_pending'
    });

    mr.currentStage = 'PICKUP_PENDING';
    mr.stageTimeline.push({
      stage: 'PICKUP_PENDING',
      user: req.user?.name || 'System',
      remarks: 'Docket generated manually.',
      status: 'Completed'
    });

    await mr.save();
    res.json({ success: true, data: mr });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 7. CREATE GATE ENTRY
export const createGateEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    const gateEntryId = `GE-${Date.now()}`;
    await WarehouseGateEntry.create({
      gateEntryId,
      returnId: mr.mrId,
      docketId: mr.docketId,
      vehicleNo: mr.vehicleNo,
      driverName: mr.driverName,
      driverMobile: mr.driverMobile,
      securityBy: req.user?.name || 'Security'
    });

    mr.currentStage = 'ARRIVED_AT_WAREHOUSE';
    mr.stageTimeline.push({
      stage: 'ARRIVED_AT_WAREHOUSE',
      user: 'Security',
      remarks: 'Vehicle arrived at gate. Gate entry created.',
      status: 'Completed'
    });

    await mr.save();
    res.json({ success: true, gateEntryId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 8. RECEIVE MATERIAL (Warehouse Automation)
export const receiveMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const { receivedQty, receiverName, remarks, damagedQty, missingQty, extraQty } = req.body;
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    mr.receivedQty = receivedQty || 0;
    mr.receiverName = receiverName || req.user?.name || 'Warehouse Operator';
    mr.receiveDate = new Date();
    mr.warehouseStatus = 'Received';
    mr.currentStage = 'RECEIVED';

    // Verification Logic: Expected vs Received
    const mismatchFound = (mr.returnQty !== receivedQty) || (damagedQty > 0) || (missingQty > 0);
    const verificationId = `VER-${Date.now()}`;
    await WarehouseVerification.create({
      verificationId,
      returnId: mr.mrId,
      expectedQty: mr.returnQty,
      receivedQty,
      mismatchFound,
      mismatchQty: Math.abs(mr.returnQty - receivedQty),
      verifiedBy: mr.receiverName,
      remarks: remarks || 'Material received and verified'
    });

    if (mismatchFound) {
      // Auto-create Loss ticket with safety fallbacks
      await LossTracking.create({
        mrId: mr.mrId,
        invoiceNumber: mr.invoiceNo || 'N/A',
        invoiceDate: mr.invoiceDate || new Date(),
        invoiceType: 'Sales',
        supplierName: mr.supplierName || mr.customerName || 'N/A',
        products: [{
          productName: mr.productName || 'N/A',
          skuCode: mr.skuCode || 'N/A',
          returnQty: mr.returnQty || 0,
          receivedQty: receivedQty || 0,
          damagedQty: damagedQty || 0,
          shortageQty: missingQty || 0,
          excessQty: extraQty || 0,
          unitRate: mr.unitPrice || 0,
          totalValue: mr.value || 0
        }],
        lossType: 'Quantity Mismatch',
        rootCause: 'Shortage/Excess at Warehouse Receive',
        lossAmount: Math.abs((mr.returnQty || 0) - (receivedQty || 0)) * (mr.unitPrice || 0),
        responsibleDepartment: 'Logistics',
        responsiblePerson: mr.receiverName,
        createdBy: 'System',
        materialStatus: 'Mismatch Found'
      });
      mr.lossClassification = 'Quantity Mismatch';
      mr.lossAmount = Math.abs((mr.returnQty || 0) - (receivedQty || 0)) * (mr.unitPrice || 0);
    }

    mr.stageTimeline.push({
      stage: 'RECEIVED',
      user: mr.receiverName,
      remarks: mismatchFound ? `Mismatch Found! Expected: ${mr.returnQty}, Received: ${receivedQty}` : 'Quantity Matched. Received successfully.',
      status: 'Completed'
    });

    // Auto-open QC process
    mr.currentStage = 'QC_PENDING';

    await mr.save();
    res.json({ success: true, data: mr });
  } catch (err) { 
    console.error('Receive Material Error:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
};

// 9. QC VERIFICATION
export const qcVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { damagedQty, reusableQty, rejectedQty, scrapQty, remarks } = req.body;
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    const qcId = `QC-${Date.now()}`;
    const status = (damagedQty > 0 || rejectedQty > 0) ? 'QC Failed' : 'QC Passed';

    await ReturnQC.create({
      qcId,
      returnId: mr.mrId,
      damagedQty,
      reusableQty,
      rejectedQty,
      scrapQty,
      status,
      inspectedBy: req.user?.name || 'QC Inspector',
      inspectedAt: new Date(),
      remarks
    });

    mr.qcStatus = status === 'QC Passed' ? 'Passed' : 'Failed';
    mr.qcApprovedQty = reusableQty;
    mr.qcRejectedQty = rejectedQty + damagedQty + scrapQty;
    mr.currentStage = 'QC_COMPLETED';

    mr.stageTimeline.push({
      stage: 'QC_COMPLETED',
      user: req.user?.name || 'QC Inspector',
      remarks: `QC Done. Status: ${status}. Reusable: ${reusableQty}, Damaged: ${damagedQty}`,
      status: 'Completed'
    });

    await mr.save();
    res.json({ success: true, data: mr });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 10. INVENTORY UPDATE
export const inventoryUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    if (mr.qcApprovedQty > 0) {
      let inv = await Inventory.findOne({ skuCode: mr.skuCode, warehouseName: mr.warehouseName });
      if (!inv) {
        inv = new Inventory({
          skuCode: mr.skuCode,
          productName: mr.productName,
          warehouseName: mr.warehouseName,
          availableQuantity: 0,
          totalQuantity: 0
        });
      }
      inv.availableQuantity += mr.qcApprovedQty;
      inv.totalQuantity += mr.qcApprovedQty;
      await inv.save();

      await StockMovement.create({
        skuCode: mr.skuCode,
        quantity: mr.qcApprovedQty,
        type: 'IN',
        source: 'Return',
        referenceId: mr.mrId,
        warehouseName: mr.warehouseName,
        remarks: `Stock increased from QC Passed Return ${mr.mrId}`
      });
    }

    mr.currentStage = 'FINANCE_PENDING';
    mr.stageTimeline.push({
      stage: 'FINANCE_PENDING',
      user: 'System',
      remarks: 'Inventory updated. Finance reconciliation pending.',
      status: 'Completed'
    });

    await mr.save();
    res.json({ success: true, data: mr });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 11. FINANCE CLOSURE
export const financeClosure = async (req, res) => {
  try {
    const { id } = req.params;
    const { refundAmount, creditNoteNo, debitNoteNo, remarks } = req.body;
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    mr.refundAmount = refundAmount;
    mr.creditNoteNo = creditNoteNo;
    mr.debitNoteNo = debitNoteNo;
    mr.currentStage = 'CLOSED';

    if (creditNoteNo) {
      await CreditNote.create({
        cnId: creditNoteNo,
        party: mr.customerName,
        against: mr.mrId,
        amount: refundAmount,
        reason: mr.reason || 'Material Return',
        status: 'Open'
      });
    }

    mr.stageTimeline.push({
      stage: 'CLOSED',
      user: req.user?.name || 'Finance Manager',
      remarks: `Finance Closed. CN: ${creditNoteNo || 'N/A'}, DN: ${debitNoteNo || 'N/A'}. ${remarks || ''}`,
      status: 'Completed'
    });

    await mr.save();
    res.json({ success: true, data: mr });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Existing functions (renamed or mapped)
export const updateStage = async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, remarks, user, status, approvalStatus } = req.body;
    
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    if (stage) mr.currentStage = stage;
    if (approvalStatus) mr.approvalStatus = approvalStatus;

    mr.stageTimeline.push({
      stage: stage || mr.currentStage,
      user: user || req.user?.name || 'System',
      remarks: remarks || `Status updated to ${approvalStatus || stage}`,
      status: status || 'Completed'
    });

    await mr.save();
    res.json({ success: true, data: mr });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 6. PROCESS QC
export const processQC = async (req, res) => {
  try {
    const { id } = req.params;
    const { qcDecision, qcRemarks, qcApprovedQty, qcRejectedQty, qcBy } = req.body;

    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    mr.qcDecision = qcDecision;
    mr.qcFinalRemarks = qcRemarks;
    mr.qcApprovedQty = qcApprovedQty;
    mr.qcRejectedQty = qcRejectedQty;
    mr.qcBy = qcBy || req.user?.name || 'QC Engineer';
    mr.qcDate = new Date();
    mr.currentStage = 'QC_PASSED';
    
    mr.stageTimeline.push({
      stage: 'QC_PASSED',
      user: mr.qcBy,
      remarks: `QC Processed: ${qcDecision}. Approved: ${qcApprovedQty}, Rejected: ${qcRejectedQty}`,
      status: 'Completed'
    });

    await mr.save();
    res.json({ success: true, data: mr });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 7. PROCESS INVENTORY
export const processInventory = async (req, res) => {
  try {
    const { id } = req.params;
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    if (mr.qcApprovedQty > 0) {
      // Find or create inventory item
      let inv = await Inventory.findOne({ skuCode: mr.skuCode, warehouseName: mr.warehouseName });
      if (!inv) {
        inv = new Inventory({
          skuCode: mr.skuCode,
          productName: mr.productName,
          warehouseName: mr.warehouseName,
          availableQuantity: 0,
          totalQuantity: 0
        });
      }
      inv.availableQuantity += mr.qcApprovedQty;
      inv.totalQuantity += mr.qcApprovedQty;
      await inv.save();

      // Log movement
      await StockMovement.create({
        skuCode: mr.skuCode,
        quantity: mr.qcApprovedQty,
        type: 'IN',
        source: 'Return',
        referenceId: mr.mrId,
        warehouseName: mr.warehouseName,
        remarks: `Inventory updated from Return ${mr.mrId}`
      });
    }

    mr.currentStage = 'FINANCE_PENDING';
    mr.stageTimeline.push({
      stage: 'FINANCE_PENDING',
      user: req.user?.name || 'Warehouse Manager',
      remarks: `Inventory updated for SKU: ${mr.skuCode}, Qty: ${mr.qcApprovedQty}. Moved to Finance Approval.`,
      status: 'Completed'
    });

    await mr.save();
    res.json({ success: true, data: mr });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 8. PROCESS FINANCE (Reconciliation)
export const processFinance = async (req, res) => {
  try {
    const { id } = req.params;
    const { refundAmount, creditNoteNo, debitNoteNo, remarks } = req.body;

    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    mr.refundAmount = refundAmount;
    mr.creditNoteNo = creditNoteNo;
    mr.debitNoteNo = debitNoteNo;
    mr.currentStage = 'CLOSED';
    mr.financeStatus = 'Completed';
    
    mr.stageTimeline.push({
      stage: 'CLOSED',
      user: req.user?.name || 'Finance Team',
      remarks: `Finance Approved & Return Closed. CN: ${creditNoteNo}, DN: ${debitNoteNo}. ${remarks}`,
      status: 'Completed'
    });

    // Create Credit Note if applicable
    if (creditNoteNo) {
      await CreditNote.create({
        cnId: creditNoteNo,
        party: mr.customerName,
        against: mr.mrId,
        amount: refundAmount,
        reason: mr.returnReason,
        status: 'Open'
      });
    }

    await mr.save();
    res.json({ success: true, data: mr });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 9. PROCESS LOSS
export const processLoss = async (req, res) => {
  try {
    const { id } = req.params;
    const { lossAmount, lossType, rootCause, remarks } = req.body;

    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    mr.lossAmount = lossAmount;
    mr.lossClassification = lossType;
    
    await LossTracking.create({
      mrId: mr.mrId,
      invoiceNumber: mr.invoiceNo,
      invoiceDate: mr.invoiceDate,
      invoiceType: 'Sales',
      supplierName: mr.customerName, // Using customerName as party
      products: [{
        productName: mr.productName,
        skuCode: mr.skuCode,
        returnQty: mr.returnQty,
        receivedQty: mr.receivedQty,
        unitRate: mr.unitPrice,
        totalValue: mr.value
      }],
      lossType,
      rootCause,
      lossAmount,
      responsibleDepartment: 'Logistics',
      responsiblePerson: req.user?.name || 'System',
      createdBy: req.user?.name || 'System'
    });

    await mr.save();
    res.json({ success: true, data: mr });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 10. UPDATE TRANSPORT
export const updateTransport = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if ID is valid ObjectId
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid Return ID format' });
    }

    const body = req.body || {};
    const { 
      trackingStatus, 
      currentLocation, 
      vehicleNo, 
      driverName, 
      driverMobile, 
      stage, 
      awbNo, 
      transport, 
      destWarehouse,
      priority,
      shipmentWeight,
      packagesCount,
      transportCost,
      estimatedDelivery,
      assignedTeam
    } = body;

    const mr = await MaterialReturn.findById(id);
    if (!mr) {
      console.error(`Return not found for ID: ${id}`);
      return res.status(404).json({ success: false, message: 'Return request not found in database' });
    }

    // Update transport details
    if (trackingStatus) mr.trackingStatus = trackingStatus;
    if (currentLocation) mr.currentLocation = currentLocation;
    if (vehicleNo !== undefined) mr.vehicleNo = vehicleNo;
    if (driverName !== undefined) mr.driverName = driverName;
    if (driverMobile !== undefined) mr.driverMobile = driverMobile;
    if (awbNo !== undefined) mr.awbNo = awbNo;
    if (transport !== undefined) mr.transport = transport;
    if (destWarehouse !== undefined) mr.warehouseName = destWarehouse;

    // Additional fields for persistence
    if (priority) mr.priority = priority;
    if (shipmentWeight) mr.shipmentWeight = shipmentWeight;
    if (packagesCount) mr.packagesCount = packagesCount;
    if (transportCost) mr.transportCost = transportCost;
    if (estimatedDelivery) mr.estimatedDelivery = estimatedDelivery;
    if (assignedTeam) mr.assignedTeam = assignedTeam;

    // Stage Transitions based on tracking status
    if (stage) {
      mr.currentStage = stage;
    } else if (trackingStatus === 'Picked Up' || trackingStatus === 'PICKED_UP') {
      mr.currentStage = 'PICKED_UP';
    } else if (trackingStatus === 'In Transit' || trackingStatus === 'IN_TRANSIT') {
      mr.currentStage = 'IN_TRANSIT';
    } else if (trackingStatus === 'Arrived' || trackingStatus === 'ARRIVED') {
      mr.currentStage = 'ARRIVED_AT_WAREHOUSE';
    } else if (trackingStatus === 'Delivered' || trackingStatus === 'DELIVERED') {
      mr.currentStage = 'RECEIVED';
    } else if (trackingStatus === 'Vehicle Assigned') {
      mr.currentStage = 'VEHICLE_ASSIGNED';
    }

    // Add timeline entry safely
    if (!mr.stageTimeline) mr.stageTimeline = [];
    
    const currentUser = req.user?.name || 'Logistics Team';
    
    if (stage || trackingStatus || vehicleNo || awbNo) {
      mr.stageTimeline.push({
        stage: mr.currentStage || 'UPDATE',
        user: currentUser,
        remarks: `Transport update: ${trackingStatus || 'Details updated'}. Vehicle: ${vehicleNo || 'N/A'}`,
        timestamp: new Date(),
        status: 'Completed'
      });
    }

    try {
      await mr.save();
      console.log(`Transport updated successfully for ${id}: Stage=${mr.currentStage}`);
      res.json({ success: true, data: mr });
    } catch (saveError) {
      console.error('Save Error in updateTransport:', saveError);
      res.status(400).json({ success: false, message: `Validation Error: ${saveError.message}` });
    }
  } catch (err) { 
    console.error('Update Transport Error Details:', {
      message: err.message,
      stack: err.stack,
      body: req.body,
      params: req.params
    });
    res.status(500).json({ success: false, message: `Internal Server Error: ${err.message}` }); 
  }
};

// 11. GET BY ID
export const getById = async (req, res) => {
  try {
    const mr = await MaterialReturn.findById(req.params.id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });
    res.json({ success: true, data: mr });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 12. REMOVE
export const remove = async (req, res) => {
  try {
    await MaterialReturn.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Return request deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 13. WAREHOUSE QUEUE
export const getWarehouseQueue = async (req, res) => {
  try {
    const list = await MaterialReturn.find({ 
      currentStage: { $in: [
        'APPROVED',
        'VEHICLE_ASSIGNED',
        'PICKUP_PENDING',
        'PICKED_UP',
        'IN_TRANSIT',
        'ARRIVED',
        'ARRIVED_AT_WAREHOUSE',
        'VERIFICATION_PENDING',
        'RECEIVED',
        'QC_PENDING'
      ] } 
    }).sort({ updatedAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 14. WAREHOUSE RETURNS
export const getWarehouseReturns = async (req, res) => {
  try {
    const list = await MaterialReturn.find({ 
      currentStage: { $in: ['RECEIVED', 'ARRIVED_AT_WAREHOUSE'] } 
    }).sort({ updatedAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 15. RECEIVE AT WAREHOUSE
export const receiveAtWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    const { receiveRemarks, receivedQty } = req.body;
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    mr.currentStage = 'RECEIVED';
    mr.receivedQty = receivedQty || mr.returnQty;
    mr.receiveDate = new Date();
    mr.stageTimeline.push({
      stage: 'RECEIVED',
      user: req.user?.name || 'Warehouse Staff',
      remarks: receiveRemarks || 'Package received at warehouse',
      status: 'Completed'
    });

    await mr.save();
    res.json({ success: true, data: mr });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 16. ISSUE CREDIT NOTE
export const issueCreditNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, cnId, reason } = req.body;
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });

    const cn = await CreditNote.create({
      cnId: cnId || `CN-${Date.now()}`,
      party: mr.customerName,
      against: mr.mrId,
      amount: amount || mr.value,
      reason: reason || mr.returnReason,
      status: 'Open'
    });

    mr.creditNoteNo = cn.cnId;
    mr.currentStage = 'CLOSED';
    await mr.save();

    res.json({ success: true, data: cn });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 17. WORKFLOW STATUS
export const getWorkflowStatus = async (req, res) => {
  try {
    const mr = await MaterialReturn.findById(req.params.id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });
    res.json({ success: true, data: { currentStage: mr.currentStage, timeline: mr.stageTimeline } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 18. PROCESS WORKFLOW STAGE
export const processWorkflowStage = async (req, res) => {
  return updateStage(req, res);
};

// Aliases for missing imports in routes
export const warehouseReceive = receiveAtWarehouse;
export const qcReceive = processQC;
export const updateTransportStatus = updateTransport;
export const updateTracking = updateTransport;
