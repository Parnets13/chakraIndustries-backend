import BrandOrder from '../models/BrandOrder.js';
import CorporateClient from '../models/CorporateClient.js';

// Generate unique Brand Order ID
const generateBrandOrderId = async () => {
  const count = await BrandOrder.countDocuments();
  return `BO-${Date.now()}-${count + 1}`;
};

// Create Brand Order
export const createBrandOrder = async (req, res) => {
  try {
    const { corporateClientId, product, quantity, unit, deliveryDate, specifications, specialInstructions, estimatedCost, paymentTerms, notes } = req.body;

    // Verify corporate client exists
    const client = await CorporateClient.findById(corporateClientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Corporate client not found' });
    }

    const brandOrderId = await generateBrandOrderId();

    const brandOrder = new BrandOrder({
      brandOrderId,
      corporateClientId,
      clientName: client.name,
      product,
      quantity,
      unit,
      deliveryDate,
      specifications,
      specialInstructions,
      estimatedCost,
      paymentTerms,
      notes,
      createdBy: req.user?.id
    });

    await brandOrder.save();

    res.status(201).json({
      success: true,
      message: 'Brand order created successfully',
      data: brandOrder
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all Brand Orders
export const getBrandOrders = async (req, res) => {
  try {
    const { status, approvalStatus, clientId } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (approvalStatus) filter.approvalStatus = approvalStatus;
    if (clientId) filter.corporateClientId = clientId;

    const brandOrders = await BrandOrder.find(filter)
      .populate('corporateClientId', 'name email phone')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: brandOrders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Brand Order by ID
export const getBrandOrderById = async (req, res) => {
  try {
    const brandOrder = await BrandOrder.findById(req.params.id)
      .populate('corporateClientId')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email');

    if (!brandOrder) {
      return res.status(404).json({ success: false, message: 'Brand order not found' });
    }

    res.json({ success: true, data: brandOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Brand Order
export const updateBrandOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const brandOrder = await BrandOrder.findByIdAndUpdate(id, updates, { new: true })
      .populate('corporateClientId')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email');

    if (!brandOrder) {
      return res.status(404).json({ success: false, message: 'Brand order not found' });
    }

    res.json({ success: true, message: 'Brand order updated successfully', data: brandOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Approve Brand Order
export const approveBrandOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalStatus } = req.body;

    if (!['Approved', 'Rejected'].includes(approvalStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid approval status' });
    }

    const brandOrder = await BrandOrder.findByIdAndUpdate(
      id,
      {
        approvalStatus,
        approvedBy: req.user?.id,
        status: approvalStatus === 'Approved' ? 'Confirmed' : 'Pending'
      },
      { new: true }
    ).populate('corporateClientId');

    if (!brandOrder) {
      return res.status(404).json({ success: false, message: 'Brand order not found' });
    }

    res.json({ success: true, message: `Brand order ${approvalStatus.toLowerCase()}`, data: brandOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Cancel Brand Order
export const cancelBrandOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const brandOrder = await BrandOrder.findByIdAndUpdate(
      id,
      { status: 'Cancelled' },
      { new: true }
    );

    if (!brandOrder) {
      return res.status(404).json({ success: false, message: 'Brand order not found' });
    }

    res.json({ success: true, message: 'Brand order cancelled', data: brandOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
