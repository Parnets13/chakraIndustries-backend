import MaterialReturn from '../models/MaterialReturn.js';
import Invoice from '../models/Invoice.js';

const genId = async (prefix, field) => {
  const year = new Date().getFullYear();
  const p = `${prefix}-${year}-`;
  const last = await MaterialReturn.findOne({ [field]: new RegExp(`^${p}`) }).sort({ [field]: -1 });
  if (!last) return `${p}001`;
  const num = parseInt(last[field].split('-')[2]) || 0;
  return `${p}${String(num + 1).padStart(3, '0')}`;
};

export const getAll = async (req, res) => {
  try {
    const { stage } = req.query;
    const filter = stage ? { stage } : {};
    const list = await MaterialReturn.find(filter)
      .populate('poId', 'poId')
      .populate('vendorId', 'companyName')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getStats = async (req, res) => {
  try {
    const total = await MaterialReturn.countDocuments();
    const inTransit = await MaterialReturn.countDocuments({ 
      stage: { $in: ['Transport_Pickup', 'In_Transit', 'Out_For_Delivery', 'Transport_Tracking'] }
    });
    const pendingQC = await MaterialReturn.countDocuments({ 
      stage: { $in: ['Delivered', 'Warehouse_Queue', 'Received_At_Warehouse', 'QC_In_Progress', 'Warehouse_Receive', 'QC_Verification'] }
    });
    const closed = await MaterialReturn.countDocuments({ 
      stage: { $in: ['QC_Completed', 'Tally_Sync', 'Closed'] }
    });
    res.json({ success: true, data: { total, inTransit, pendingQC, closed } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
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
    supplierName: invoice.partyName,
    supplierEmail: invoice.partyEmail || '',
    supplierPincode: invoice.partyPostal || '',
    supplierGSTNo: invoice.partyGST || '',
    supplierAddress: invoice.partyAddress || '',
    mobileNumber: invoice.partyPhone || '',
    pickupAddress: invoice.partyAddress || '',
    pinCode: invoice.partyPostal || '',
    gstNumber: invoice.partyGST || '',
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

export const getInvoiceContext = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNo: req.params.invoiceNo });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: buildInvoiceReturnContext(invoice) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const create = async (req, res) => {
  try {
    const returnRequestId = await genId('RR', 'returnRequestId');
    const mrId     = await genId('MR', 'mrId');
    const docketId = await genId('DKT', 'docketId');
    const invoice = req.body.invoiceNo ? await Invoice.findOne({ invoiceNo: req.body.invoiceNo }) : null;
    const invoiceContext = buildInvoiceReturnContext(invoice) || {};
    const body = Object.fromEntries(
      Object.entries(req.body).filter(([, value]) => value !== '' && value !== undefined && value !== null)
    );
    const mr = await MaterialReturn.create({
      ...invoiceContext,
      ...body,
      returnRequestId,
      mrId,
      docketId,
      stage: body.stage || 'Return_Request_Create',
      currentWorkflowStage: body.currentWorkflowStage || 'Return_Request_Create',
      Return_Request_Create_processedAt: new Date(),
      Return_Request_Create_processedBy: req.user?.name || 'System',
    });
    res.status(201).json({ success: true, data: mr });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateStage = async (req, res) => {
  try {
    const stage = req.body.stage;
    if (!stage) return res.status(400).json({ success: false, message: 'Stage is required' });
    const mr = await MaterialReturn.findByIdAndUpdate(
      req.params.id,
      {
        stage,
        currentWorkflowStage: stage,
        [`${stage}_processedAt`]: new Date(),
        [`${stage}_processedBy`]: req.user?.name || 'System',
        ...(stage === 'Manager_Approval' ? { approvalStatus: 'Approved', returnStatus: 'Approved' } : {}),
        ...(stage === 'QC_Verification' ? { qcStatus: 'In Progress' } : {}),
        ...(stage === 'Finance_Reconciliation' ? { reconciliationStatus: 'In Progress', ledgerStatus: 'Updated' } : {}),
        ...(stage === 'Tally_Sync' ? { reconciliationStatus: 'Completed', ledgerStatus: 'Reconciled' } : {}),
      },
      { new: true }
    );
    if (!mr) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: mr });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const issueCreditNote = async (req, res) => {
  try {
    const { creditNoteId } = req.body;
    const mr = await MaterialReturn.findByIdAndUpdate(
      req.params.id,
      { creditNoteId },
      { new: true }
    );
    if (!mr) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: mr });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const getWarehouseQueue = async (req, res) => {
  try {
    const queueItems = await MaterialReturn.find({ 
      stage: { $in: ['Delivered', 'Warehouse_Queue'] }
    }).sort({ createdAt: -1 });
    res.json({ success: true, data: queueItems });
  } catch (err) { 
    res.status(500).json({ success: false, message: err.message }); 
  }
};

export const warehouseReceive = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      receivedQty, 
      damagedQtyReceived, 
      missingQtyReceived, 
      warehouseLocation, 
      receivedBy, 
      warehouseRemarks 
    } = req.body;

    const mr = await MaterialReturn.findByIdAndUpdate(
      id,
      {
        receivedQty: parseInt(receivedQty) || 0,
        damagedQtyReceived: parseInt(damagedQtyReceived) || 0,
        missingQtyReceived: parseInt(missingQtyReceived) || 0,
        warehouseLocation,
        receivedBy,
        warehouseRemarks,
        receiveDate: new Date(),
        stage: 'Received_At_Warehouse'
      },
      { new: true }
    );

    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });
    res.json({ success: true, data: mr });
  } catch (err) { 
    res.status(400).json({ success: false, message: err.message }); 
  }
};

export const qcReceive = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      qcReceivedQty, 
      qcApprovedQty, 
      qcRejectedQty, 
      qcBy, 
      qcFinalRemarks 
    } = req.body;

    const mr = await MaterialReturn.findByIdAndUpdate(
      id,
      {
        qcReceivedQty: parseInt(qcReceivedQty) || 0,
        qcApprovedQty: parseInt(qcApprovedQty) || 0,
        qcRejectedQty: parseInt(qcRejectedQty) || 0,
        qcBy,
        qcFinalRemarks,
        qcDate: new Date(),
        stage: 'QC_Completed'
      },
      { new: true }
    );

    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });
    res.json({ success: true, data: mr });
  } catch (err) { 
    res.status(400).json({ success: false, message: err.message }); 
  }
};

export const updateTransportStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { transportStatus } = req.body;
    
    let newStage = 'In_Transit';
    if (transportStatus === 'OUT_FOR_DELIVERY') {
      newStage = 'Out_For_Delivery';
    } else if (transportStatus === 'DELIVERED') {
      newStage = 'Warehouse_Queue';
    }

    const mr = await MaterialReturn.findByIdAndUpdate(
      id,
      { stage: newStage },
      { new: true }
    );

    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });
    res.json({ success: true, data: mr });
  } catch (err) { 
    res.status(400).json({ success: false, message: err.message }); 
  }
};

export const remove = async (req, res) => {
  try {
    await MaterialReturn.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Workflow tracking endpoints
export const getWorkflowStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const mr = await MaterialReturn.findById(id);
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });
    
    const workflowData = {
      currentWorkflowStage: mr.currentWorkflowStage || 'Return_Created',
      stageDetails: {
        stageName: mr.currentWorkflowStage || 'Return_Created',
        status: mr.stage,
        assignedTo: mr.assignedTo || 'System',
        lastUpdated: mr.updatedAt
      }
    };
    
    res.json({ success: true, data: workflowData });
  } catch (err) { 
    res.status(500).json({ success: false, message: err.message }); 
  }
};

export const processWorkflowStage = async (req, res) => {
  try {
    const { id } = req.params;
    const { stage } = req.body;
    
    const mr = await MaterialReturn.findByIdAndUpdate(
      id,
      { 
        currentWorkflowStage: stage,
        [`${stage}_processedAt`]: new Date(),
        [`${stage}_processedBy`]: 'System'
      },
      { new: true }
    );
    
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });
    res.json({ success: true, data: mr });
  } catch (err) { 
    res.status(400).json({ success: false, message: err.message }); 
  }
};

// Warehouse receive endpoints
export const getWarehouseReturns = async (req, res) => {
  try {
    const returns = await MaterialReturn.find({ 
      stage: { $in: ['Delivered', 'Warehouse_Queue', 'Received_At_Warehouse'] }
    }).sort({ createdAt: -1 });
    res.json({ success: true, data: returns });
  } catch (err) { 
    res.status(500).json({ success: false, message: err.message }); 
  }
};

export const receiveAtWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    const { receivedBy, receivedDate, status } = req.body;
    
    const mr = await MaterialReturn.findByIdAndUpdate(
      id,
      {
        receivedBy,
        receiveDate: receivedDate || new Date(),
        stage: status || 'Received_At_Warehouse'
      },
      { new: true }
    );
    
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });
    res.json({ success: true, data: mr });
  } catch (err) { 
    res.status(400).json({ success: false, message: err.message }); 
  }
};

export const processQC = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      receivedQty, 
      damageQty, 
      missingQty, 
      warehouseLocation, 
      notes, 
      qcStatus, 
      qcBy, 
      qcDate 
    } = req.body;
    
    const mr = await MaterialReturn.findByIdAndUpdate(
      id,
      {
        qcReceivedQty: receivedQty,
        qcDamageQty: damageQty,
        qcMissingQty: missingQty,
        warehouseLocation,
        qcNotes: notes,
        qcStatus,
        qcBy,
        qcDate: qcDate || new Date(),
        stage: 'QC_Completed'
      },
      { new: true }
    );
    
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });
    res.json({ success: true, data: mr });
  } catch (err) { 
    res.status(400).json({ success: false, message: err.message }); 
  }
};

export const updateTracking = async (req, res) => {
  try {
    const { id } = req.params;
    const { awbNo, transport, currentLocation, trackingStatus } = req.body;
    
    const updateData = {};
    if (awbNo) updateData.awbNo = awbNo;
    if (transport) updateData.transport = transport;
    if (currentLocation) updateData.currentLocation = currentLocation;
    if (trackingStatus) updateData.trackingStatus = trackingStatus;
    
    const mr = await MaterialReturn.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );
    
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });
    res.json({ success: true, data: mr });
  } catch (err) { 
    res.status(400).json({ success: false, message: err.message }); 
  }
};
