import OEMFinishedGoods from '../models/OEMFinishedGoods.js';
import OEMOrder from '../models/OEMOrder.js';
import QualityCheck from '../models/QualityCheck.js';

// Generate unique Finished Goods ID
const generateFinishedGoodsId = async () => {
  const count = await OEMFinishedGoods.countDocuments();
  return `FG-${Date.now()}-${count + 1}`;
};

// Create Finished Goods from OEM Order
export const createFinishedGoods = async (req, res) => {
  try {
    const { oemOrderId, batchNumber, qcCheckId, qcStatus, defectCount, defectDetails, storageLocation } = req.body;

    // Verify OEM order exists
    const oemOrder = await OEMOrder.findById(oemOrderId);
    if (!oemOrder) {
      return res.status(404).json({ success: false, message: 'OEM order not found' });
    }

    // Verify QC check if provided
    if (qcCheckId) {
      const qcCheck = await QualityCheck.findById(qcCheckId);
      if (!qcCheck) {
        return res.status(404).json({ success: false, message: 'QC check not found' });
      }
    }

    const finishedGoodsId = await generateFinishedGoodsId();

    const finishedGoods = new OEMFinishedGoods({
      finishedGoodsId,
      oemOrderId,
      product: oemOrder.product,
      quantity: oemOrder.quantity,
      unit: oemOrder.unit,
      batchNumber,
      qcCheckId,
      qcStatus,
      defectCount: defectCount || 0,
      defectDetails,
      productionDate: new Date(),
      qcDate: qcStatus !== 'Pending' ? new Date() : null,
      storageLocation,
      status: qcStatus === 'Passed' ? 'In-Storage' : 'In-Storage'
    });

    await finishedGoods.save();

    // Update OEM order
    await OEMOrder.findByIdAndUpdate(oemOrderId, {
      finishedGoodsId: finishedGoods._id,
      qcCheckId,
      qcStatus,
      defectCount,
      status: 'Finished-Goods'
    });

    res.status(201).json({
      success: true,
      message: 'Finished goods created successfully',
      data: finishedGoods
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all Finished Goods
export const getFinishedGoods = async (req, res) => {
  try {
    const { status, qcStatus, oemOrderId } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (qcStatus) filter.qcStatus = qcStatus;
    if (oemOrderId) filter.oemOrderId = oemOrderId;

    const finishedGoods = await OEMFinishedGoods.find(filter)
      .populate('oemOrderId', 'oemOrderId product quantity')
      .populate('qcCheckId', 'qcId result')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: finishedGoods });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Finished Goods by ID
export const getFinishedGoodsById = async (req, res) => {
  try {
    const finishedGoods = await OEMFinishedGoods.findById(req.params.id)
      .populate('oemOrderId')
      .populate('qcCheckId');

    if (!finishedGoods) {
      return res.status(404).json({ success: false, message: 'Finished goods not found' });
    }

    res.json({ success: true, data: finishedGoods });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Finished Goods Status
export const updateFinishedGoodsStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, dispatchDate, trackingNumber } = req.body;

    const finishedGoods = await OEMFinishedGoods.findByIdAndUpdate(
      id,
      {
        status,
        dispatchDate: status === 'Dispatched' ? dispatchDate || new Date() : dispatchDate,
        trackingNumber
      },
      { new: true }
    );

    if (!finishedGoods) {
      return res.status(404).json({ success: false, message: 'Finished goods not found' });
    }

    // Update OEM order dispatch status
    if (status === 'Dispatched') {
      await OEMOrder.findByIdAndUpdate(finishedGoods.oemOrderId, {
        dispatchStatus: 'Shipped',
        dispatchDate,
        trackingNumber
      });
    }

    res.json({ success: true, message: 'Finished goods status updated', data: finishedGoods });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Finished Goods Summary
export const getFinishedGoodsSummary = async (req, res) => {
  try {
    const summary = {
      totalFinishedGoods: await OEMFinishedGoods.countDocuments(),
      byStatus: await OEMFinishedGoods.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      byQCStatus: await OEMFinishedGoods.aggregate([
        { $group: { _id: '$qcStatus', count: { $sum: 1 } } }
      ]),
      totalDefects: await OEMFinishedGoods.aggregate([
        { $group: { _id: null, totalDefects: { $sum: '$defectCount' } } }
      ])
    };

    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
