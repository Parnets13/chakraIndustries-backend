import MaterialReturn from '../models/MaterialReturn.js';

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
      stage: { $in: ['Transport_Pickup', 'In_Transit', 'Out_For_Delivery'] }
    });
    const pendingQC = await MaterialReturn.countDocuments({ 
      stage: { $in: ['Delivered', 'Warehouse_Queue', 'Received_At_Warehouse', 'QC_In_Progress'] }
    });
    const closed = await MaterialReturn.countDocuments({ 
      stage: { $in: ['QC_Completed', 'Closed'] }
    });
    res.json({ success: true, data: { total, inTransit, pendingQC, closed } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const create = async (req, res) => {
  try {
    const mrId     = await genId('MR', 'mrId');
    const docketId = await genId('DKT', 'docketId');
    const mr = await MaterialReturn.create({ ...req.body, mrId, docketId });
    res.status(201).json({ success: true, data: mr });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateStage = async (req, res) => {
  try {
    const mr = await MaterialReturn.findByIdAndUpdate(
      req.params.id,
      { stage: req.body.stage },
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
