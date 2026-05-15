import DocketTracking from '../models/DocketTracking.js';
import MaterialReturn from '../models/MaterialReturn.js';
import Warehouse from '../models/Warehouse.js';
import Vendor from '../models/Vendor.js';

// Get all dockets with enhanced filtering and pagination
const getAllDockets = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      search, 
      status, 
      courier,
      priority,
      dateFrom,
      dateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      delayed = false
    } = req.query;

    // Build filter object
    const filter = { isActive: true };

    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [
        { docketId: regex },
        { mrId: regex },
        { returnRequestId: regex },
        { awbLrNumber: regex },
        { 'contactDetails.supplierName': regex },
        { courierPartner: regex },
        { vehicleNumber: regex },
        { driverName: regex }
      ];
    }

    if (status && status !== 'all') filter.transportStatus = status;
    if (courier && courier !== 'all') filter.courierPartner = courier;
    if (priority && priority !== 'all') filter.priority = priority;

    if (dateFrom || dateTo) {
      filter.pickupDate = {};
      if (dateFrom) filter.pickupDate.$gte = new Date(dateFrom);
      if (dateTo) filter.pickupDate.$lte = new Date(dateTo);
    }

    // Filter for delayed dockets
    if (delayed === 'true') {
      filter.transportStatus = { $nin: ['delivered', 'cancelled', 'closed'] };
      filter.estimatedDelivery = { $lt: new Date() };
    }

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const sortObj = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [dockets, total] = await Promise.all([
      DocketTracking.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(limit))
        .populate('integrationRefs.warehouseId', 'name address')
        .populate('integrationRefs.vendorId', 'name contactPerson mobile')
        .lean(),
      DocketTracking.countDocuments(filter)
    ]);

    // Add computed fields
    const enhancedDockets = dockets.map(docket => ({
      ...docket,
      isDelayed: docket.transportStatus !== 'delivered' && 
                docket.transportStatus !== 'closed' && 
                new Date() > new Date(docket.estimatedDelivery),
      actualTransitDays: docket.actualDeliveryDate ? 
        Math.ceil((new Date(docket.actualDeliveryDate) - new Date(docket.pickupDate)) / (1000 * 60 * 60 * 24)) :
        Math.ceil((new Date() - new Date(docket.pickupDate)) / (1000 * 60 * 60 * 24))
    }));

    res.json({
      success: true,
      data: enhancedDockets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching dockets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dockets',
      error: error.message
    });
  }
};

// Get single docket by ID
const getDocketById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const docket = await DocketTracking.findById(id);
    
    if (!docket || !docket.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Docket not found'
      });
    }

    res.json({
      success: true,
      data: docket
    });
  } catch (error) {
    console.error('Error fetching docket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch docket',
      error: error.message
    });
  }
};

// Create new docket with auto-generation
const createDocket = async (req, res) => {
  try {
    const docketData = req.body;

    // Auto-generate docket ID if not provided
    if (!docketData.docketId) {
      const year = new Date().getFullYear();
      const count = await DocketTracking.countDocuments({ 
        docketId: new RegExp(`^DKT-${year}-`) 
      });
      const sequence = String(count + 1).padStart(5, '0');
      docketData.docketId = `DKT-${year}-${sequence}`;
    }

    // Auto-calculate estimated delivery if not provided
    if (!docketData.estimatedDelivery && docketData.pickupDate) {
      const pickupDate = new Date(docketData.pickupDate);
      const estimatedDelivery = new Date(pickupDate);
      estimatedDelivery.setDate(estimatedDelivery.getDate() + 2); // Default 2 days
      docketData.estimatedDelivery = estimatedDelivery;
    }

    // Check if docket ID or AWB/LR number already exists
    const existingDocket = await DocketTracking.findOne({
      $or: [
        { docketId: docketData.docketId },
        { awbLrNumber: docketData.awbLrNumber }
      ],
      isActive: true
    });

    if (existingDocket) {
      return res.status(400).json({
        success: false,
        message: 'Docket ID or AWB/LR Number already exists'
      });
    }

    // Initialize tracking history
    if (!docketData.trackingHistory) {
      docketData.trackingHistory = [{
        status: docketData.transportStatus || 'pickup_pending',
        location: docketData.pickupLocation,
        timestamp: new Date(),
        remarks: 'Docket created'
      }];
    }

    // Create new docket
    const docket = new DocketTracking(docketData);
    await docket.save();

    res.status(201).json({
      success: true,
      message: 'Docket created successfully',
      data: docket
    });
  } catch (error) {
    console.error('Error creating docket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create docket',
      error: error.message
    });
  }
};

// Update docket
const updateDocket = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const docket = await DocketTracking.findById(id);
    
    if (!docket || !docket.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Docket not found'
      });
    }

    // Check for duplicate docket ID or LR number if they're being updated
    if (updateData.docketId || updateData.lrNumber) {
      const existingDocket = await DocketTracking.findOne({
        _id: { $ne: id },
        $or: [
          ...(updateData.docketId ? [{ docketId: updateData.docketId }] : []),
          ...(updateData.lrNumber ? [{ lrNumber: updateData.lrNumber }] : [])
        ],
        isActive: true
      });

      if (existingDocket) {
        return res.status(400).json({
          success: false,
          message: 'Docket ID or LR Number already exists'
        });
      }
    }

    // Update docket
    Object.assign(docket, updateData);
    await docket.save();

    res.json({
      success: true,
      message: 'Docket updated successfully',
      data: docket
    });
  } catch (error) {
    console.error('Error updating docket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update docket',
      error: error.message
    });
  }
};

// Update docket status
const updateDocketStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, location, remarks } = req.body;

    const docket = await DocketTracking.findById(id);
    
    if (!docket || !docket.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Docket not found'
      });
    }

    // Update status
    docket.materialStatus = status;
    
    // Add to tracking history
    docket.trackingHistory.push({
      status,
      location,
      remarks,
      timestamp: new Date()
    });

    // Set actual arrival if delivered
    if (status === 'delivered' && !docket.actualArrival) {
      docket.actualArrival = new Date();
    }

    await docket.save();

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: docket
    });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
      error: error.message
    });
  }
};

// Delete docket (soft delete)
const deleteDocket = async (req, res) => {
  try {
    const { id } = req.params;

    const docket = await DocketTracking.findById(id);
    
    if (!docket || !docket.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Docket not found'
      });
    }

    // Soft delete
    docket.isActive = false;
    await docket.save();

    res.json({
      success: true,
      message: 'Docket deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting docket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete docket',
      error: error.message
    });
  }
};

// Track by LR number
const trackByLRNumber = async (req, res) => {
  try {
    const { lrNumber } = req.params;

    const docket = await DocketTracking.findOne({ 
      lrNumber, 
      isActive: true 
    });

    if (!docket) {
      return res.status(404).json({
        success: false,
        message: 'No docket found with this LR number'
      });
    }

    res.json({
      success: true,
      data: docket
    });
  } catch (error) {
    console.error('Error tracking docket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track docket',
      error: error.message
    });
  }
};

// Get dashboard statistics
const getDashboardStats = async (req, res) => {
  try {
    const stats = await DocketTracking.getDashboardStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
};

// Get delayed dockets
const getDelayedDockets = async (req, res) => {
  try {
    const delayedDockets = await DocketTracking.find({
      materialStatus: { $nin: ['delivered', 'cancelled'] },
      expectedArrival: { $lt: new Date() },
      isActive: true
    }).sort({ expectedArrival: 1 });

    res.json({
      success: true,
      data: delayedDockets
    });
  } catch (error) {
    console.error('Error fetching delayed dockets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delayed dockets',
      error: error.message
    });
  }
};

// Bulk update status
const bulkUpdateStatus = async (req, res) => {
  try {
    const { docketIds, status, location, remarks } = req.body;

    if (!docketIds || !Array.isArray(docketIds) || docketIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Docket IDs array is required'
      });
    }

    const updatePromises = docketIds.map(async (id) => {
      const docket = await DocketTracking.findById(id);
      if (docket && docket.isActive) {
        docket.materialStatus = status;
        docket.trackingHistory.push({
          status,
          location,
          remarks,
          timestamp: new Date()
        });
        
        if (status === 'delivered' && !docket.actualArrival) {
          docket.actualArrival = new Date();
        }
        
        return docket.save();
      }
    });

    await Promise.all(updatePromises);

    res.json({
      success: true,
      message: `${docketIds.length} dockets updated successfully`
    });
  } catch (error) {
    console.error('Error bulk updating dockets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk update dockets',
      error: error.message
    });
  }
};


// Upload POD
const uploadPOD = async (req, res) => {
  try {
    const { id } = req.params;
    const podData = req.body;

    const docket = await DocketTracking.findById(id);
    
    if (!docket || !docket.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Docket not found'
      });
    }

    // Update POD details
    docket.podDetails = {
      ...docket.podDetails,
      ...podData,
      verificationStatus: 'pending'
    };

    docket.podStatus = 'uploaded';
    
    // Add to tracking history
    docket.trackingHistory.push({
      status: 'pod_uploaded',
      location: docket.deliveryLocation,
      timestamp: new Date(),
      remarks: 'POD uploaded',
      updatedBy: podData.uploadedBy || 'driver'
    });

    await docket.save();

    res.json({
      success: true,
      message: 'POD uploaded successfully',
      data: docket
    });
  } catch (error) {
    console.error('Error uploading POD:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload POD',
      error: error.message
    });
  }
};

// Upload attachment
const uploadAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    const attachmentData = req.body;

    const docket = await DocketTracking.findById(id);
    
    if (!docket || !docket.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Docket not found'
      });
    }

    // Add to attachments
    docket.attachments.push({
      fileName: attachmentData.fileName,
      fileType: attachmentData.fileType,
      fileUrl: attachmentData.fileUrl,
      uploadedAt: new Date(),
      uploadedBy: attachmentData.uploadedBy || 'admin',
      category: attachmentData.category || 'Other'
    });

    await docket.save();

    res.json({
      success: true,
      message: 'Attachment uploaded successfully',
      data: docket
    });
  } catch (error) {
    console.error('Error uploading attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload attachment',
      error: error.message
    });
  }
};

// Get tracking timeline
const getTrackingTimeline = async (req, res) => {
  try {
    const { id } = req.params;

    const docket = await DocketTracking.findById(id);
    
    if (!docket || !docket.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Docket not found'
      });
    }

    res.json({
      success: true,
      data: docket.trackingHistory
    });
  } catch (error) {
    console.error('Error fetching tracking timeline:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tracking timeline',
      error: error.message
    });
  }
};

// Close docket
const closeDocket = async (req, res) => {
  try {
    const { id } = req.params;
    const closeData = req.body;

    const docket = await DocketTracking.findById(id);
    
    if (!docket || !docket.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Docket not found'
      });
    }

    docket.transportStatus = 'closed';
    docket.podStatus = 'verified';
    
    // Add to tracking history
    docket.trackingHistory.push({
      status: 'closed',
      location: docket.deliveryLocation,
      timestamp: new Date(),
      remarks: closeData.remarks || 'Docket closed successfully',
      updatedBy: closeData.closedBy || 'admin'
    });

    await docket.save();

    res.json({
      success: true,
      message: 'Docket closed successfully',
      data: docket
    });
  } catch (error) {
    console.error('Error closing docket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to close docket',
      error: error.message
    });
  }
};

export {
  getAllDockets,
  getDocketById,
  createDocket,
  updateDocket,
  updateDocketStatus,
  deleteDocket,
  trackByLRNumber,
  getDashboardStats,
  getDelayedDockets,
  bulkUpdateStatus,
  uploadPOD,
  uploadAttachment,
  getTrackingTimeline,
  closeDocket
};