import GRN from '../models/GRN.js';
import QualityCheck from '../models/QualityCheck.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import { createBatchFromGRN, createInventoryFromGRN } from '../services/grnInventoryService.js';
import { logActivity } from '../utils/activityLogger.js';

// Generate QC ID
const generateQCId = async () => {
  const year = new Date().getFullYear();
  const prefix = `QC-${year}-`;
  const last = await QualityCheck.findOne({ qcId: new RegExp(`^${prefix}`) }).sort({ qcId: -1 });
  if (!last) return `${prefix}001`;
  const num = parseInt(last.qcId.split('-')[2]) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
};

// Generate GRN ID (GRN-2026-001)
const generateGRNId = async () => {
  const year = new Date().getFullYear();
  const prefix = `GRN-${year}-`;
  const last = await GRN.findOne({ grnId: new RegExp(`^${prefix}`) })
    .sort({ grnId: -1 })
    .limit(1);
  if (!last) return `${prefix}001`;
  const lastNum = parseInt(last.grnId.split('-')[2]) || 0;
  return `${prefix}${String(lastNum + 1).padStart(3, '0')}`;
};

// CREATE
export const createGRN = async (req, res) => {
  try {
    // Validate PO exists and is Approved
    if (req.body.poId) {
      const po = await PurchaseOrder.findById(req.body.poId);
      if (!po) {
        return res.status(400).json({ success: false, message: 'Purchase Order not found' });
      }
      if (po.status !== 'Approved') {
        return res.status(400).json({ success: false, message: `Cannot create GRN: PO ${po.poId} is not approved (current status: ${po.status}). Please approve the PO first.` });
      }
    }

    const grnId = await generateGRNId();
    const grn = new GRN({ ...req.body, grnId, qcStatus: 'Pending', approvalStatus: 'Not Required' });
    const saved = await grn.save();
    if (req.user) {
      await logActivity(req, req.user, 'CREATE_GRN', {
        module: 'procurement',
        description: `Created GRN ${saved.grnId}`,
        targetId: saved._id.toString(),
        targetType: 'GRN'
      });
    }

    // Auto-create batch from GRN
    try {
      await createBatchFromGRN(saved);
    } catch (batchError) {
      console.error('Error creating batch:', batchError);
      // Don't fail GRN creation if batch creation fails
    }

    // Auto-create QC record
    const qcId = await generateQCId();
    const items = (req.body.items || []).map(it => ({
      itemName: it.name || it.itemName || 'Item',
      receivedQty: parseInt(it.receivedQty) || parseInt(it.qty) || req.body.receivedQuantity || 0,
      passedQty: 0,
      failedQty: 0,
      remarks: '',
    }));
    // fallback if no items array
    if (items.length === 0) {
      items.push({ itemName: 'Received Goods', receivedQty: req.body.receivedQuantity || 0, passedQty: 0, failedQty: 0, remarks: '' });
    }
    await QualityCheck.create({
      qcId,
      grnId: saved._id,
      poId: req.body.poId || null,
      vendorId: req.body.vendorId || null,
      items,
      status: 'Pending',
    });

    const populated = await GRN.findById(saved._id)
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName vendorId')
      .populate('warehouseId', 'warehouseId name location')
      .populate('batchId')
      .populate('inventoryId');
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// READ ALL
export const getAllGRNs = async (req, res) => {
  try {
    const { status, vendor, search, page, limit } = req.query;
    const filter = {};
    if (status) filter.grnStatus = status;
    if (vendor) filter.vendorId = vendor;
    if (search) {
      filter.$or = [
        { grnId: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum  = parseInt(page)  || 0;
    const limitNum = parseInt(limit) || 0;
    const usePagination = pageNum > 0 && limitNum > 0;
    const skip = usePagination ? (pageNum - 1) * limitNum : 0;

    const [grns, totalCount] = await Promise.all([
      GRN.find(filter)
        .populate('poId', 'poId grandTotal')
        .populate('vendorId', 'companyName vendorId')
        .populate('warehouseId', 'warehouseId name location')
        .populate('batchId')
        .populate('inventoryId')
        .sort({ createdAt: -1 })
        .skip(usePagination ? skip : 0)
        .limit(usePagination ? limitNum : 0),
      usePagination ? GRN.countDocuments(filter) : Promise.resolve(null),
    ]);

    const response = { success: true, data: grns };
    if (usePagination) {
      response.pagination = {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
      };
    }
    res.json(response);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ STATS
export const getGRNStats = async (req, res) => {
  try {
    const total = await GRN.countDocuments();
    const received = await GRN.countDocuments({ grnStatus: 'Received' });
    const qcPending = await GRN.countDocuments({ grnStatus: 'QC_Pending' });
    const qcApproved = await GRN.countDocuments({ grnStatus: 'QC_Approved' });
    const inventoryUpdated = await GRN.countDocuments({ grnStatus: 'Inventory_Updated' });

    res.json({
      success: true,
      data: {
        total,
        received,
        qcPending,
        qcApproved,
        inventoryUpdated
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ ONE
export const getGRNById = async (req, res) => {
  try {
    const grn = await GRN.findById(req.params.id)
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName vendorId')
      .populate('warehouseId', 'warehouseId name location')
      .populate('batchId')
      .populate('inventoryId');
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });
    res.json({ success: true, data: grn });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// UPDATE
export const updateGRN = async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    const grn = await GRN.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName vendorId')
      .populate('batchId')
      .populate('inventoryId');
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });
    res.json({ success: true, data: grn });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE
export const deleteGRN = async (req, res) => {
  try {
    const grn = await GRN.findByIdAndDelete(req.params.id);
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });
    res.json({ success: true, message: 'GRN deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
