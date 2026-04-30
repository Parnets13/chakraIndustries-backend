import QualityCheck from '../models/QualityCheck.js';
import GRN from '../models/GRN.js';
import Inventory from '../models/Inventory.js';
import DefectiveStock from '../models/DefectiveStock.js';
import StockMovement from '../models/StockMovement.js';
import inventoryService from '../services/inventoryService.js';

// Generate QC ID
const generateQCId = async () => {
  const count = await QualityCheck.countDocuments();
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `QC-${date}-${String(count + 1).padStart(5, '0')}`;
};

// CREATE QC Inspection
export const createQualityCheck = async (req, res) => {
  const session = await QualityCheck.startSession();
  session.startTransaction();
  
  try {
    const {
      grnId,
      acceptedQuantity,
      rejectedQuantity,
      rejectionReason,
      inspectionNotes,
      inspectedBy,
      batchNumber,
      warehouseId,
      storageLocation
    } = req.body;

    // Validate GRN exists
    const grn = await GRN.findById(grnId).session(session);
    if (!grn) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Validate quantities
    if (acceptedQuantity + rejectedQuantity !== grn.receivedQuantity) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Accepted (${acceptedQuantity}) + Rejected (${rejectedQuantity}) must equal Received (${grn.receivedQuantity})`
      });
    }

    const qcId = await generateQCId();

    // Create QC record
    const qc = new QualityCheck({
      qcId,
      grnId,
      poId: grn.poId,
      vendorId: grn.vendorId,
      skuId: grn.items?.[0]?.skuId || 'UNKNOWN',
      receivedQuantity: grn.receivedQuantity,
      acceptedQuantity,
      rejectedQuantity,
      rejectionReason,
      inspectionNotes,
      inspectedBy,
      batchNumber,
      warehouseId,
      storageLocation,
      status: rejectedQuantity === 0 ? 'Approved' : rejectedQuantity === grn.receivedQuantity ? 'Rejected' : 'Partial'
    });

    await qc.save({ session });

    // Update GRN status
    grn.acceptedQuantity = acceptedQuantity;
    grn.rejectedQuantity = rejectedQuantity;
    grn.grnStatus = qc.status === 'Approved' ? 'QC_Approved' : qc.status === 'Rejected' ? 'QC_Rejected' : 'Partial_Approved';
    grn.qcCompletedDate = new Date();
    await grn.save({ session });

    // Handle accepted items - Update Inventory
    if (acceptedQuantity > 0) {
      const skuId = grn.items?.[0]?.skuId || 'UNKNOWN';
      const itemName = grn.items?.[0]?.name || 'Unknown Item';

      let inventory = await Inventory.findOne({
        sku: skuId,
        warehouse: warehouseId,
        batch: batchNumber
      }).session(session);

      if (!inventory) {
        inventory = new Inventory({
          sku: skuId,
          name: itemName,
          warehouse: warehouseId,
          batch: batchNumber,
          totalQuantity: acceptedQuantity,
          availableQuantity: acceptedQuantity,
          reservedQuantity: 0,
          grnId,
          qcId: qc._id,
          location: storageLocation,
          lastMovementDate: new Date()
        });
      } else {
        inventory.totalQuantity += acceptedQuantity;
        inventory.availableQuantity += acceptedQuantity;
        inventory.lastMovementDate = new Date();
      }

      await inventory.save({ session });

      // Log stock movement for accepted items
      await StockMovement.create([{
        type: 'GRN_Received',
        skuId,
        quantity: acceptedQuantity,
        warehouse: warehouseId,
        reference: grnId,
        remarks: `QC Approved - Batch: ${batchNumber}`,
        createdBy: inspectedBy,
        createdAt: new Date()
      }], { session });
    }

    // Handle rejected items - Create Defective Stock
    if (rejectedQuantity > 0) {
      const skuId = grn.items?.[0]?.skuId || 'UNKNOWN';
      const itemName = grn.items?.[0]?.name || 'Unknown Item';

      const defectiveStock = new DefectiveStock({
        skuId,
        name: itemName,
        quantity: rejectedQuantity,
        warehouse: warehouseId,
        batch: batchNumber,
        reason: rejectionReason,
        grnId,
        qcId: qc._id,
        status: 'Pending',
        remarks: inspectionNotes,
        createdBy: inspectedBy
      });

      await defectiveStock.save({ session });

      // Log stock movement for rejected items
      await StockMovement.create([{
        type: 'QC_Rejected',
        skuId,
        quantity: rejectedQuantity,
        warehouse: warehouseId,
        reference: grnId,
        remarks: `QC Rejected - Reason: ${rejectionReason}`,
        createdBy: inspectedBy,
        createdAt: new Date()
      }], { session });
    }

    // Update GRN inventory status
    grn.grnStatus = 'Inventory_Updated';
    grn.inventoryUpdatedDate = new Date();
    await grn.save({ session });

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      data: qc,
      message: `QC completed: ${acceptedQuantity} accepted, ${rejectedQuantity} rejected`
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: err.message });
  } finally {
    session.endSession();
  }
};

// GET ALL QC Records
export const getAllQualityChecks = async (req, res) => {
  try {
    const { status, grnId, warehouseId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (grnId) filter.grnId = grnId;
    if (warehouseId) filter.warehouseId = warehouseId;

    const qcs = await QualityCheck.find(filter)
      .populate('grnId', 'grnId')
      .populate('vendorId', 'companyName')
      .populate('inspectedBy', 'name email')
      .sort({ inspectionDate: -1 });

    res.json({ success: true, data: qcs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET QC by ID
export const getQualityCheckById = async (req, res) => {
  try {
    const qc = await QualityCheck.findById(req.params.id)
      .populate('grnId')
      .populate('poId')
      .populate('vendorId')
      .populate('inspectedBy', 'name email');

    if (!qc) return res.status(404).json({ success: false, message: 'QC record not found' });
    res.json({ success: true, data: qc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// UPDATE QC Status
export const updateQualityCheckStatus = async (req, res) => {
  try {
    const { status, approvalNotes } = req.body;
    const validStatuses = ['Pending', 'Approved', 'Rejected', 'Partial'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const qc = await QualityCheck.findByIdAndUpdate(
      req.params.id,
      { status, inspectionNotes: approvalNotes || qc.inspectionNotes, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!qc) return res.status(404).json({ success: false, message: 'QC record not found' });
    res.json({ success: true, data: qc });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET QC Stats
export const getQCStats = async (req, res) => {
  try {
    const total = await QualityCheck.countDocuments();
    const approved = await QualityCheck.countDocuments({ status: 'Approved' });
    const rejected = await QualityCheck.countDocuments({ status: 'Rejected' });
    const partial = await QualityCheck.countDocuments({ status: 'Partial' });
    const pending = await QualityCheck.countDocuments({ status: 'Pending' });

    const totalAccepted = await QualityCheck.aggregate([
      { $group: { _id: null, total: { $sum: '$acceptedQuantity' } } }
    ]);

    const totalRejected = await QualityCheck.aggregate([
      { $group: { _id: null, total: { $sum: '$rejectedQuantity' } } }
    ]);

    res.json({
      success: true,
      data: {
        total,
        approved,
        rejected,
        partial,
        pending,
        totalAccepted: totalAccepted[0]?.total || 0,
        totalRejected: totalRejected[0]?.total || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE QC Record
export const deleteQualityCheck = async (req, res) => {
  try {
    const qc = await QualityCheck.findByIdAndDelete(req.params.id);
    if (!qc) return res.status(404).json({ success: false, message: 'QC record not found' });
    res.json({ success: true, message: 'QC record deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
