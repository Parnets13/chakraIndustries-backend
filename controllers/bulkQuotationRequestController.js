import BulkQuotationRequest from '../models/BulkQuotationRequest.js';
import QuotationRequestItem from '../models/QuotationRequestItem.js';
import CorporateClient from '../models/CorporateClient.js';

// Create new bulk quotation request
export const createBulkQuotationRequest = async (req, res) => {
  try {
    const {
      clientId,
      deliveryDate,
      products,
      packaging,
      paymentTerms,
      creditTerms,
      notes
    } = req.body;

    // Validate client exists
    const client = await CorporateClient.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Corporate client not found' });
    }

    // Create bulk quotation request
    const request = await BulkQuotationRequest.create({
      clientId,
      clientName: client.name,
      deliveryDate: new Date(deliveryDate),
      products,
      packaging,
      paymentTerms: paymentTerms || 'Net 30',
      creditTerms,
      notes,
      status: 'Draft',
      createdBy: req.user?._id,
      updatedBy: req.user?._id
    });

    // Create individual items for each product
    const items = [];
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const item = await QuotationRequestItem.create({
        requestId: request._id,
        itemName: product.productName,
        requestedQuantity: product.quantity,
        unit: product.unit || 'Pieces',
        specifications: product.specifications,
        createdBy: req.user?._id,
        updatedBy: req.user?._id
      });
      items.push(item);
    }

    res.status(201).json({
      success: true,
      data: {
        request,
        items
      },
      message: 'Bulk quotation request created successfully'
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Get all bulk quotation requests
export const getAllBulkQuotationRequests = async (req, res) => {
  try {
    const { status, clientId, page = 1, limit = 20 } = req.query;
    
    const filter = {};
    if (status) filter.status = status;
    if (clientId) filter.clientId = clientId;

    const requests = await BulkQuotationRequest.find(filter)
      .populate('clientId', 'name tier creditLimit')
      .populate('createdBy', 'name')
      .populate('approvalDetails.approvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await BulkQuotationRequest.countDocuments(filter);

    res.json({
      success: true,
      data: requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get bulk quotation request by ID
export const getBulkQuotationRequestById = async (req, res) => {
  try {
    const request = await BulkQuotationRequest.findById(req.params.id)
      .populate('clientId')
      .populate('createdBy', 'name')
      .populate('approvalDetails.approvedBy', 'name')
      .populate('inventoryCheck.checkedBy', 'name')
      .populate('productionPlan.plannedBy', 'name');

    if (!request) {
      return res.status(404).json({ success: false, message: 'Bulk quotation request not found' });
    }

    // Get associated items
    const items = await QuotationRequestItem.find({ requestId: request._id });

    res.json({
      success: true,
      data: {
        request,
        items
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update bulk quotation request status
export const updateRequestStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;
    
    const request = await BulkQuotationRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    await request.updateStatus(status, req.user?._id);
    
    if (notes) {
      request.internalNotes = notes;
      await request.save();
    }

    res.json({
      success: true,
      data: request,
      message: `Request status updated to ${status}`
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Submit request for approval
export const submitForApproval = async (req, res) => {
  try {
    const request = await BulkQuotationRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.status !== 'Draft') {
      return res.status(400).json({ success: false, message: 'Only draft requests can be submitted' });
    }

    await request.updateStatus('Submitted', req.user?._id);

    res.json({
      success: true,
      data: request,
      message: 'Request submitted for approval'
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Approve request with pricing
export const approveRequest = async (req, res) => {
  try {
    const {
      estimatedCost,
      sellingPrice,
      approvalNotes
    } = req.body;

    const request = await BulkQuotationRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.status !== 'Submitted' && request.status !== 'Under Review') {
      return res.status(400).json({ success: false, message: 'Request is not in reviewable state' });
    }

    // Calculate margin
    const margin = sellingPrice - estimatedCost;
    const marginPercentage = (margin / sellingPrice) * 100;

    // Update approval details
    request.approvalDetails = {
      approvedBy: req.user?._id,
      approvalNotes,
      priceApproval: {
        estimatedCost,
        sellingPrice,
        margin,
        approved: true
      }
    };

    await request.updateStatus('Approved', req.user?._id);

    // Trigger inventory check
    await triggerInventoryCheck(request._id, req.user?._id);

    res.json({
      success: true,
      data: request,
      message: 'Request approved successfully'
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Perform inventory check
export const performInventoryCheck = async (req, res) => {
  try {
    const request = await BulkQuotationRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const items = await QuotationRequestItem.find({ requestId: request._id });
    const stockDetails = [];
    let overallStatus = 'Available';

    // Check stock for each item
    for (const item of items) {
      const availability = item.checkInventoryAvailability();
      
      stockDetails.push({
        productName: item.itemName,
        requiredQty: item.requestedQuantity,
        availableQty: item.inventory.availableStock,
        shortfall: availability.shortfall,
        estimatedRestockDate: item.inventory.estimatedRestockDate
      });

      if (availability.status === 'Shortfall') {
        overallStatus = overallStatus === 'Available' ? 'Partial' : 'Not Available';
      }
    }

    // Update inventory check results
    request.inventoryCheck = {
      checkedAt: new Date(),
      checkedBy: req.user?._id,
      stockStatus: overallStatus,
      stockDetails
    };

    await request.save();

    // If stock is available or partial, trigger production planning
    if (overallStatus !== 'Not Available') {
      await triggerProductionPlanning(request._id, req.user?._id);
    }

    res.json({
      success: true,
      data: request.inventoryCheck,
      message: 'Inventory check completed'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create production plan
export const createProductionPlan = async (req, res) => {
  try {
    const {
      manufacturingRequired,
      estimatedProductionTime,
      productionStartDate,
      productionEndDate
    } = req.body;

    const request = await BulkQuotationRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    request.productionPlan = {
      plannedAt: new Date(),
      plannedBy: req.user?._id,
      manufacturingRequired,
      estimatedProductionTime,
      productionStartDate: new Date(productionStartDate),
      productionEndDate: new Date(productionEndDate),
      workOrderIds: []
    };

    await request.save();

    // Update items that require manufacturing
    if (manufacturingRequired) {
      await QuotationRequestItem.updateMany(
        { requestId: request._id },
        { 
          'production.manufacturingRequired': true,
          'production.estimatedProductionTime': estimatedProductionTime,
          status: 'Approved'
        }
      );
    }

    res.json({
      success: true,
      data: request.productionPlan,
      message: 'Production plan created successfully'
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Get requests by status
export const getRequestsByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const requests = await BulkQuotationRequest.getByStatus(status);
    
    res.json({
      success: true,
      data: requests,
      count: requests.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get pending approvals
export const getPendingApprovals = async (req, res) => {
  try {
    const requests = await BulkQuotationRequest.getPendingApproval();
    
    res.json({
      success: true,
      data: requests,
      count: requests.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get dashboard statistics
export const getDashboardStats = async (req, res) => {
  try {
    const [
      totalRequests,
      pendingApproval,
      approved,
      inProduction,
      completed
    ] = await Promise.all([
      BulkQuotationRequest.countDocuments(),
      BulkQuotationRequest.countDocuments({ status: 'Submitted' }),
      BulkQuotationRequest.countDocuments({ status: 'Approved' }),
      BulkQuotationRequest.countDocuments({ status: { $in: ['In Production', 'Quality Check'] } }),
      BulkQuotationRequest.countDocuments({ status: 'Converted' })
    ]);

    // Calculate total pipeline value
    const pipelineRequests = await BulkQuotationRequest.find({
      status: { $in: ['Approved', 'Quoted'] },
      'approvalDetails.priceApproval.sellingPrice': { $exists: true }
    });

    const pipelineValue = pipelineRequests.reduce((total, req) => {
      return total + (req.approvalDetails?.priceApproval?.sellingPrice || 0);
    }, 0);

    res.json({
      success: true,
      data: {
        totalRequests,
        pendingApproval,
        approved,
        inProduction,
        completed,
        pipelineValue
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Helper functions
async function triggerInventoryCheck(requestId, userId) {
  // This would typically trigger an automated inventory check
  // For now, we'll just update the status
  const request = await BulkQuotationRequest.findById(requestId);
  if (request) {
    request.inventoryCheck = {
      checkedAt: new Date(),
      checkedBy: userId,
      stockStatus: 'Pending Check'
    };
    await request.save();
  }
}

async function triggerProductionPlanning(requestId, userId) {
  // This would typically trigger production planning workflow
  // For now, we'll just update the status
  const request = await BulkQuotationRequest.findById(requestId);
  if (request && request.inventoryCheck.stockStatus !== 'Not Available') {
    request.productionPlan = {
      plannedAt: new Date(),
      plannedBy: userId,
      manufacturingRequired: true
    };
    await request.save();
  }
}