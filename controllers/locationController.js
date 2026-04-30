import Location from '../models/Location.js';
import Warehouse from '../models/Warehouse.js';

// Get all locations
export const getAllLocations = async (req, res) => {
  try {
    const { warehouse, zone, status } = req.query;
    
    let query = {};
    if (warehouse) query.warehouse = warehouse;
    if (zone) query.zone = zone;
    if (status) query.status = status;
    
    const locations = await Location.find(query)
      .populate('warehouse', 'warehouseId name location')
      .sort({ zone: 1, rack: 1, shelf: 1 });
    
    res.json({
      success: true,
      data: locations
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching locations',
      error: error.message
    });
  }
};

// Get locations by warehouse
export const getLocationsByWarehouse = async (req, res) => {
  try {
    const { warehouseId } = req.params;
    
    const locations = await Location.find({ warehouse: warehouseId })
      .populate('warehouse', 'warehouseId name')
      .sort({ zone: 1, rack: 1, shelf: 1 });
    
    res.json({
      success: true,
      data: locations
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching warehouse locations',
      error: error.message
    });
  }
};

// Get location details
export const getLocationDetails = async (req, res) => {
  try {
    const location = await Location.findById(req.params.id)
      .populate('warehouse', 'warehouseId name location');
    
    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }
    
    res.json({
      success: true,
      data: location
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching location',
      error: error.message
    });
  }
};

// Get location capacity
export const getLocationCapacity = async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    
    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }
    
    const capacityPercent = (location.usedCapacity / location.totalCapacity) * 100;
    
    res.json({
      success: true,
      data: {
        locationId: location.locationId,
        totalCapacity: location.totalCapacity,
        usedCapacity: location.usedCapacity,
        availableCapacity: location.totalCapacity - location.usedCapacity,
        capacityPercent: Math.round(capacityPercent),
        status: capacityPercent >= 90 ? 'Critical' : capacityPercent >= 80 ? 'Warning' : 'Normal'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching location capacity',
      error: error.message
    });
  }
};

// Create location
export const createLocation = async (req, res) => {
  try {
    const { warehouse, zone, rack, shelf, totalCapacity } = req.body;
    
    // Verify warehouse exists
    const wh = await Warehouse.findById(warehouse);
    if (!wh) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found'
      });
    }
    
    // Generate location ID
    const locationId = `LOC-${zone}-${rack}-${shelf}`;
    
    const location = new Location({
      locationId,
      warehouse,
      zone,
      rack,
      shelf,
      totalCapacity: totalCapacity || 100,
      bins: []
    });
    
    await location.save();
    
    res.status(201).json({
      success: true,
      message: 'Location created successfully',
      data: location
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating location',
      error: error.message
    });
  }
};

// Update location capacity
export const updateLocationCapacity = async (req, res) => {
  try {
    const { capacity } = req.body;
    
    const location = await Location.findByIdAndUpdate(
      req.params.id,
      { totalCapacity: capacity },
      { new: true, runValidators: true }
    );
    
    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Location capacity updated successfully',
      data: location
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating location capacity',
      error: error.message
    });
  }
};

// Add bin to location
export const addBin = async (req, res) => {
  try {
    const { binId, sku, quantity } = req.body;
    
    const location = await Location.findById(req.params.id);
    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }
    
    location.bins.push({ binId, sku, quantity: quantity || 0 });
    await location.save();
    
    res.json({
      success: true,
      message: 'Bin added successfully',
      data: location
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error adding bin',
      error: error.message
    });
  }
};

// Update bin quantity
export const updateBinQuantity = async (req, res) => {
  try {
    const { binId, quantity } = req.body;
    
    const location = await Location.findById(req.params.id);
    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }
    
    const bin = location.bins.find(b => b.binId === binId);
    if (!bin) {
      return res.status(404).json({
        success: false,
        message: 'Bin not found'
      });
    }
    
    bin.quantity = quantity;
    await location.save();
    
    res.json({
      success: true,
      message: 'Bin quantity updated successfully',
      data: location
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating bin quantity',
      error: error.message
    });
  }
};

// Delete location
export const deleteLocation = async (req, res) => {
  try {
    const location = await Location.findByIdAndDelete(req.params.id);
    
    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Location deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting location',
      error: error.message
    });
  }
};
