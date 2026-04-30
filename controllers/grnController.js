import GRN from '../models/GRN.js';
import { updateInventoryFromGRN, reverseInventoryFromGRN } from '../services/inventoryService.js';

// Generate GRN ID
const generateGRNId = async () => {
  const count = await GRN.countDocuments();
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `GRN-${date}-${String(count + 1).padStart(5, '0')}`;
};

// CREATE
export const createGRN = async (req, res) => {
  try {
    const grnId = await generateGRNId();
    const grn = new GRN({
      ...req.body,
      grnId,
      grnStatus: 'Received'
    });
    const saved = await grn.save();

    // Update inventory when GRN is created
    try {
      await updateInventoryFromGRN(saved, req.body.warehouseId);
    } catch (invErr) {
      console.error('Inventory update error:', invErr);
      // Don't fail the GRN creation if inventory update fails
    }

    // Populate references for response
    const populated = await GRN.findById(saved._id)
      .populate('poId', 'poId')
      .populate('vendorId', 'companyName')
      .populate('warehouseId', 'name');

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// READ ALL
export const getAllGRNs = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.grnStatus = status;

    const grns = await GRN.find(filter)
      .populate('poId', 'poId')
      .populate('vendorId', 'companyName')
      .populate('warehouseId', 'name')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: grns });
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
      .populate('poId')
      .populate('vendorId')
      .populate('warehouseId');
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
    const grn = await GRN.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
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
