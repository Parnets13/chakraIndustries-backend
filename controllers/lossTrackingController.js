import LossTracking from '../models/LossTracking.js';
import MaterialReturn from '../models/MaterialReturn.js';
import Vendor from '../models/Vendor.js';
import Client from '../models/Client.js';

// Get all loss tracking records with advanced filtering
export const getAllLossTracking = async (req, res) => {
  try {
    const { 
      finalStatus, 
      priority, 
      lossType, 
      reconciliationStatus,
      responsibleDepartment,
      supplierName,
      dateFrom,
      dateTo,
      slaStatus,
      page = 1, 
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    const filter = {};
    if (finalStatus) filter.finalStatus = finalStatus;
    if (priority) filter.priority = priority;
    if (lossType) filter.lossType = lossType;
    if (reconciliationStatus) filter.reconciliationStatus = reconciliationStatus;
    if (responsibleDepartment) filter.responsibleDepartment = responsibleDepartment;
    if (supplierName) filter.supplierName = new RegExp(supplierName, 'i');
    
    // Date range filter
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    const skip = (page - 1) * limit;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    const lossRecords = await LossTracking.find(filter)
      .populate('supplierId', 'name email')
      .populate('customerId', 'name email')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await LossTracking.countDocuments(filter);

    // Calculate comprehensive dashboard stats
    const stats = await LossTracking.aggregate([
      {
        $facet: {
          // Financial Summary
          financialSummary: [
            {
              $group: {
                _id: null,
                totalLossAmount: { $sum: '$lossAmount' },
                totalRecoverableAmount: { $sum: '$recoverableAmount' },
                totalNonRecoverableAmount: { $sum: '$nonRecoverableAmount' },
                avgLossAmount: { $avg: '$lossAmount' },
                totalCases: { $sum: 1 }
              }
            }
          ],
          
          // Status Breakdown
          statusBreakdown: [
            {
              $group: {
                _id: '$finalStatus',
                count: { $sum: 1 },
                totalAmount: { $sum: '$lossAmount' }
              }
            }
          ],
          
          // Loss Type Analysis
          lossTypeBreakdown: [
            {
              $group: {
                _id: '$lossType',
                count: { $sum: 1 },
                totalAmount: { $sum: '$lossAmount' },
                avgAmount: { $avg: '$lossAmount' }
              }
            }
          ],
          
          // Priority Distribution
          priorityBreakdown: [
            {
              $group: {
                _id: '$priority',
                count: { $sum: 1 },
                totalAmount: { $sum: '$lossAmount' }
              }
            }
          ],
          
          // Reconciliation Status
          reconciliationBreakdown: [
            {
              $group: {
                _id: '$reconciliationStatus',
                count: { $sum: 1 },
                totalAmount: { $sum: '$lossAmount' }
              }
            }
          ],
          
          // Department Wise Analysis
          departmentBreakdown: [
            {
              $group: {
                _id: '$responsibleDepartment',
                count: { $sum: 1 },
                totalAmount: { $sum: '$lossAmount' }
              }
            }
          ],
          
          // SLA Performance
          slaPerformance: [
            {
              $addFields: {
                slaStatus: {
                  $cond: {
                    if: { $eq: ['$finalStatus', 'Closed'] },
                    then: 'Completed',
                    else: {
                      $cond: {
                        if: { $lt: ['$slaDueDate', new Date()] },
                        then: 'Overdue',
                        else: 'On Track'
                      }
                    }
                  }
                }
              }
            },
            {
              $group: {
                _id: '$slaStatus',
                count: { $sum: 1 }
              }
            }
          ]
        }
      }
    ]);

    res.json({
      success: true,
      data: lossRecords,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      analytics: stats[0] || {}
    });
  } catch (error) {
    console.error('Error fetching loss tracking records:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching loss tracking records',
      error: error.message
    });
  }
};

// Create new loss tracking record with auto data population
export const createLossTracking = async (req, res) => {
  try {
    const {
      mrId,
      products,
      lossType,
      rootCause,
      responsibleDepartment,
      assignedTo, // From frontend
      priority,
      status, // From frontend
      resolutionNotes,
      correctiveAction,
      preventiveAction
    } = req.body;

    // Auto-populate data from Material Return
    const materialReturn = await MaterialReturn.findOne({ mrId });
    if (!materialReturn) {
      return res.status(404).json({
        success: false,
        message: 'Material Return not found'
      });
    }

    // Process products and calculate totals
    const processedProducts = (products || []).map(p => ({
      ...p,
      returnQty: p.returnQty || p.damagedQty || 0,
      totalValue: (Number(p.damagedQty || 0) * Number(p.unitRate || 0))
    }));

    const totalLossAmount = processedProducts.reduce((sum, p) => sum + p.totalValue, 0);

    const lossRecord = new LossTracking({
      mrId,
      docketId: materialReturn.docketId,
      returnRequestId: materialReturn.returnRequestId,
      
      // Auto-populated from Material Return
      supplierName: materialReturn.supplierName,
      supplierId: materialReturn.supplierId || null,
      customerName: materialReturn.customerName,
      customerId: materialReturn.customerId || null,
      
      // Auto-populated from Invoice
      invoiceNumber: materialReturn.invoiceNo,
      invoiceDate: materialReturn.invoiceDate || new Date(),
      invoiceType: 'Purchase',
      
      products: processedProducts,
      lossType,
      rootCause,
      lossAmount: totalLossAmount,
      recoverableAmount: req.body.recoverableAmount || 0,
      
      responsibleDepartment,
      responsiblePerson: assignedTo || 'Unassigned',
      priority: priority || 'Medium',
      
      finalStatus: status || 'Open',
      resolutionNotes,
      correctiveAction,
      preventiveAction,
      
      createdBy: req.user?.name || 'System'
    });

    // Add initial activity log
    lossRecord.addActivity('Loss Record Created', req.user?.name || 'System', `Loss amount: ₹${totalLossAmount}`);

    await lossRecord.save();

    res.status(201).json({
      success: true,
      message: 'Loss tracking record created successfully',
      data: lossRecord
    });
  } catch (error) {
    console.error('Error creating loss tracking record:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating loss tracking record',
      error: error.message
    });
  }
};

// Update loss tracking record with activity logging
export const updateLossTracking = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const userName = req.user?.name || 'System';
    
    const lossRecord = await LossTracking.findById(id);
    if (!lossRecord) {
      return res.status(404).json({
        success: false,
        message: 'Loss tracking record not found'
      });
    }

    // Track changes for activity log
    const changes = [];
    Object.keys(updateData).forEach(key => {
      if (lossRecord[key] !== updateData[key]) {
        changes.push(`${key}: ${lossRecord[key]} → ${updateData[key]}`);
      }
    });

    // Update fields
    Object.assign(lossRecord, updateData);
    lossRecord.lastUpdatedBy = userName;

    // Auto-update status based on reconciliation
    if (updateData.materialStatus || updateData.financialStatus) {
      lossRecord.updateReconciliationStatus();
    }

    // Add activity log
    if (changes.length > 0) {
      lossRecord.addActivity('Record Updated', userName, changes.join(', '));
    }

    await lossRecord.save();

    res.json({
      success: true,
      message: 'Loss tracking record updated successfully',
      data: lossRecord
    });
  } catch (error) {
    console.error('Error updating loss tracking record:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating loss tracking record',
      error: error.message
    });
  }
};

// Raise Debit Note
export const raiseDebitNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;
    
    const lossRecord = await LossTracking.findById(id);
    if (!lossRecord) {
      return res.status(404).json({
        success: false,
        message: 'Loss tracking record not found'
      });
    }

    // Generate Debit Note Number
    const dnNumber = `DN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    
    lossRecord.debitNoteNumber = dnNumber;
    lossRecord.recoverableAmount = amount;
    lossRecord.financialStatus = 'Debit Note Raised';
    
    lossRecord.addActivity('Debit Note Raised', req.user?.name || 'System', 
      `DN: ${dnNumber}, Amount: ₹${amount}, Reason: ${reason}`);

    await lossRecord.save();

    res.json({
      success: true,
      message: `Debit note ${dnNumber} raised successfully`,
      data: lossRecord
    });
  } catch (error) {
    console.error('Error raising debit note:', error);
    res.status(500).json({
      success: false,
      message: 'Error raising debit note',
      error: error.message
    });
  }
};

// Issue Credit Note
export const issueCreditNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;
    
    const lossRecord = await LossTracking.findById(id);
    if (!lossRecord) {
      return res.status(404).json({
        success: false,
        message: 'Loss tracking record not found'
      });
    }

    // Generate Credit Note Number
    const cnNumber = `CN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    
    lossRecord.creditNoteNumber = cnNumber;
    lossRecord.financialStatus = 'Credit Note Issued';
    
    lossRecord.addActivity('Credit Note Issued', req.user?.name || 'System', 
      `CN: ${cnNumber}, Amount: ₹${amount}, Reason: ${reason}`);

    await lossRecord.save();

    res.json({
      success: true,
      message: `Credit note ${cnNumber} issued successfully`,
      data: lossRecord
    });
  } catch (error) {
    console.error('Error issuing credit note:', error);
    res.status(500).json({
      success: false,
      message: 'Error issuing credit note',
      error: error.message
    });
  }
};

// Escalate loss tracking record
export const escalateLoss = async (req, res) => {
  try {
    const { id } = req.params;
    const { escalationReason } = req.body;

    const lossRecord = await LossTracking.findById(id);
    if (!lossRecord) {
      return res.status(404).json({
        success: false,
        message: 'Loss tracking record not found'
      });
    }

    lossRecord.escalationLevel += 1;
    lossRecord.finalStatus = 'Escalated';
    
    // Auto-upgrade priority on escalation
    const priorityUpgrade = {
      'Low': 'Medium',
      'Medium': 'High', 
      'High': 'Critical',
      'Critical': 'Critical'
    };
    lossRecord.priority = priorityUpgrade[lossRecord.priority];

    lossRecord.addActivity('Case Escalated', req.user?.name || 'System', 
      `Level ${lossRecord.escalationLevel}: ${escalationReason}`);

    await lossRecord.save();

    res.json({
      success: true,
      message: 'Loss tracking record escalated successfully',
      data: lossRecord
    });
  } catch (error) {
    console.error('Error escalating loss tracking record:', error);
    res.status(500).json({
      success: false,
      message: 'Error escalating loss tracking record',
      error: error.message
    });
  }
};

// Close loss tracking record
export const closeLossRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const { closureReason } = req.body;

    const lossRecord = await LossTracking.findById(id);
    if (!lossRecord) {
      return res.status(404).json({
        success: false,
        message: 'Loss tracking record not found'
      });
    }

    lossRecord.finalStatus = 'Closed';
    lossRecord.closedBy = req.user?.name || 'System';
    lossRecord.closureDate = new Date();
    lossRecord.reconciliationStatus = 'Fully Reconciled';

    lossRecord.addActivity('Case Closed', req.user?.name || 'System', closureReason);

    await lossRecord.save();

    res.json({
      success: true,
      message: 'Loss tracking record closed successfully',
      data: lossRecord
    });
  } catch (error) {
    console.error('Error closing loss tracking record:', error);
    res.status(500).json({
      success: false,
      message: 'Error closing loss tracking record',
      error: error.message
    });
  }
};

// Get comprehensive dashboard analytics
export const getDashboardAnalytics = async (req, res) => {
  try {
    const { dateFrom, dateTo, department } = req.query;
    
    const matchFilter = {};
    if (dateFrom || dateTo) {
      matchFilter.createdAt = {};
      if (dateFrom) matchFilter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) matchFilter.createdAt.$lte = new Date(dateTo);
    }
    if (department) matchFilter.responsibleDepartment = department;

    const analytics = await LossTracking.aggregate([
      { $match: matchFilter },
      {
        $facet: {
          // Executive Summary
          executiveSummary: [
            {
              $group: {
                _id: null,
                totalCases: { $sum: 1 },
                totalLossAmount: { $sum: '$lossAmount' },
                totalRecoverable: { $sum: '$recoverableAmount' },
                totalNonRecoverable: { $sum: '$nonRecoverableAmount' },
                avgResolutionTime: { $avg: '$daysOpen' },
                criticalCases: { $sum: { $cond: [{ $eq: ['$priority', 'Critical'] }, 1, 0] } },
                overdueCase: { $sum: { $cond: [{ $lt: ['$slaDueDate', new Date()] }, 1, 0] } }
              }
            }
          ],
          
          // Trend Analysis (Monthly)
          monthlyTrend: [
            {
              $group: {
                _id: {
                  year: { $year: '$createdAt' },
                  month: { $month: '$createdAt' }
                },
                cases: { $sum: 1 },
                amount: { $sum: '$lossAmount' }
              }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
          ],
          
          // Top Loss Categories
          topLossTypes: [
            {
              $group: {
                _id: '$lossType',
                count: { $sum: 1 },
                totalAmount: { $sum: '$lossAmount' },
                avgAmount: { $avg: '$lossAmount' }
              }
            },
            { $sort: { totalAmount: -1 } },
            { $limit: 10 }
          ],
          
          // Department Performance
          departmentPerformance: [
            {
              $group: {
                _id: '$responsibleDepartment',
                totalCases: { $sum: 1 },
                totalAmount: { $sum: '$lossAmount' },
                closedCases: { $sum: { $cond: [{ $eq: ['$finalStatus', 'Closed'] }, 1, 0] } },
                avgResolutionTime: { $avg: '$daysOpen' }
              }
            },
            {
              $addFields: {
                closureRate: { $divide: ['$closedCases', '$totalCases'] }
              }
            }
          ],
          
          // Recovery Analysis
          recoveryAnalysis: [
            {
              $group: {
                _id: '$financialStatus',
                count: { $sum: 1 },
                totalAmount: { $sum: '$lossAmount' },
                recoveredAmount: { $sum: '$recoverableAmount' }
              }
            }
          ]
        }
      }
    ]);

    res.json({
      success: true,
      data: analytics[0] || {}
    });
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard analytics',
      error: error.message
    });
  }
};

// Get single loss tracking record with full details
export const getLossTrackingById = async (req, res) => {
  try {
    const lossRecord = await LossTracking.findById(req.params.id)
      .populate('supplierId', 'name email phone address')
      .populate('customerId', 'name email phone address');

    if (!lossRecord) {
      return res.status(404).json({
        success: false,
        message: 'Loss tracking record not found'
      });
    }

    res.json({
      success: true,
      data: lossRecord
    });
  } catch (error) {
    console.error('Error fetching loss tracking record:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching loss tracking record',
      error: error.message
    });
  }
};

// Delete loss tracking record
export const deleteLossTracking = async (req, res) => {
  try {
    const { id } = req.params;

    const lossRecord = await LossTracking.findByIdAndDelete(id);
    if (!lossRecord) {
      return res.status(404).json({
        success: false,
        message: 'Loss tracking record not found'
      });
    }

    res.json({
      success: true,
      message: 'Loss tracking record deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting loss tracking record:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting loss tracking record',
      error: error.message
    });
  }
};

// Legacy method for backward compatibility
export const getStats = async (req, res) => {
  try {
    const stats = await LossTracking.aggregate([
      {
        $group: {
          _id: null,
          totalLossValue: { $sum: '$lossAmount' },
          courierLost: { $sum: { $cond: [{ $eq: ['$lossType', 'Transit Damage'] }, 1, 0] } },
          qcRejected: { $sum: { $cond: [{ $eq: ['$lossType', 'QC Rejection'] }, 1, 0] } },
          cnMismatch: { $sum: { $cond: [{ $eq: ['$lossType', 'Invoice Mismatch'] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        totalStats: stats
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching stats',
      error: error.message
    });
  }
};