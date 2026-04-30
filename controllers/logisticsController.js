import StockMovement from '../models/StockMovement.js';
import Inventory from '../models/Inventory.js';

export const getDispatchDashboard = async (req, res) => {
  try {
    const movements = await StockMovement.find({ type: 'Outward' })
      .populate('inventory', 'sku name')
      .sort({ createdAt: -1 })
      .limit(10);

    const formattedData = movements.map(m => ({
      id: m._id,
      sku: m.inventory?.sku || 'N/A',
      item: m.inventory?.name || 'N/A',
      qty: m.quantity,
      from: m.fromLocation || 'Warehouse',
      to: m.toLocation || 'Destination',
      date: m.createdAt?.toLocaleDateString('en-IN') || 'N/A',
      ref: m.reference || 'N/A'
    }));

    res.json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching dispatch data',
      error: error.message
    });
  }
};

export const getMovementHistory = async (req, res) => {
  try {
    const movements = await StockMovement.find()
      .populate('inventory', 'sku name')
      .sort({ createdAt: -1 })
      .limit(50);

    const formattedData = movements.map(m => ({
      id: m._id,
      type: m.type,
      sku: m.inventory?.sku || 'N/A',
      item: m.inventory?.name || 'N/A',
      qty: m.quantity,
      from: m.fromLocation || 'N/A',
      to: m.toLocation || 'N/A',
      date: m.createdAt?.toLocaleDateString('en-IN') || 'N/A',
      ref: m.reference || 'N/A'
    }));

    res.json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching movement history',
      error: error.message
    });
  }
};
