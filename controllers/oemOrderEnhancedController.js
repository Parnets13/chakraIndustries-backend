import OEMOrder from '../models/OEMOrder.js';
import {
  syncOEMOrderToTally,
  syncOEMInvoiceToTally,
  syncPaymentToTally,
  getOEMTallySyncStatus,
  retryFailedTallySync
} from '../services/oemTallyService.js';
import {
  validateOEMInventory,
  reserveOEMMaterials,
  consumeOEMMaterials,
  autoGeneratePRForShortfall,
  releaseReservedMaterials,
  getOEMInventoryStatus
} from '../services/oemInventoryService.js';
import {
  calculateEstimatedCost,
  calculateActualCost,
  getBrandProfitability,
  getCostVarianceAnalysis,
  getOEMCostBreakdown
} from '../services/oemCostingService.js';
import {
  autoCreateWorkOrder
} from '../services/oemWorkflowService.js';

/**
 * Validate inventory and auto-generate PR if needed
 */
export const validateAndReserveInventory = async (req, res) => {
  try {
    const { id } = req.params;
    const { autoGeneratePR = true } = req.body;

    // Validate inventory
    const validation = await validateOEMInventory(id);
    if (!validation.success) {
      return res.status(400).json(validation);
    }

    // If not all available and autoGeneratePR is true, create PR
    if (!validation.data.allAvailable && autoGeneratePR) {
      const prResult = await autoGeneratePRForShortfall(id);
      if (prResult.success) {
        return res.json({
          success: true,
          message: 'Inventory validated and PR auto-generated for shortfall',
          data: {
            validation: validation.data,
            purchaseRequisition: prResult.data
          }
        });
      }
    }

    res.json({
      success: true,
      message: validation.data.allAvailable ? 'All materials available' : 'Some materials unavailable',
      data: validation.data
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Reserve materials and trigger work order creation
 */
export const reserveAndProceed = async (req, res) => {
  try {
    const { id } = req.params;

    // Reserve materials
    const reservation = await reserveOEMMaterials(id);
    if (!reservation.success) {
      return res.status(400).json(reservation);
    }

    // Auto create work order
    const workOrderResult = await autoCreateWorkOrder(id);
    if (!workOrderResult.success) {
      return res.status(400).json(workOrderResult);
    }

    res.json({
      success: true,
      message: 'Materials reserved and work order created successfully',
      data: {
        reservation: reservation.data,
        workOrder: workOrderResult.data
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Consume materials when production starts
 */
export const consumeMaterials = async (req, res) => {
  try {
    const { id } = req.params;
    const { workOrderId } = req.body;

    if (!workOrderId) {
      return res.status(400).json({ success: false, message: 'Work order ID is required' });
    }

    const consumption = await consumeOEMMaterials(workOrderId);
    if (!consumption.success) {
      return res.status(400).json(consumption);
    }

    res.json({
      success: true,
      message: 'Materials consumed successfully',
      data: consumption.data
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Release reserved materials (for cancellation)
 */
export const releaseMaterials = async (req, res) => {
  try {
    const { id } = req.params;

    const release = await releaseReservedMaterials(id);
    if (!release.success) {
      return res.status(400).json(release);
    }

    res.json({
      success: true,
      message: 'Reserved materials released',
      data: release.data
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get inventory status for OEM order
 */
export const getInventoryStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const status = await getOEMInventoryStatus(id);
    if (!status.success) {
      return res.status(404).json(status);
    }

    res.json(status);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Calculate estimated cost
 */
export const calculateEstimated = async (req, res) => {
  try {
    const { id } = req.params;

    const cost = await calculateEstimatedCost(id);
    if (!cost.success) {
      return res.status(400).json(cost);
    }

    res.json(cost);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Calculate actual cost after production
 */
export const calculateActual = async (req, res) => {
  try {
    const { id } = req.params;
    const { laborHours = 0 } = req.body;

    const cost = await calculateActualCost(id, laborHours);
    if (!cost.success) {
      return res.status(400).json(cost);
    }

    res.json(cost);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get cost breakdown
 */
export const getCostBreakdown = async (req, res) => {
  try {
    const { id } = req.params;

    const breakdown = await getOEMCostBreakdown(id);
    if (!breakdown.success) {
      return res.status(404).json(breakdown);
    }

    res.json(breakdown);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Sync OEM order to Tally
 */
export const syncToTally = async (req, res) => {
  try {
    const { id } = req.params;

    const sync = await syncOEMOrderToTally(id);
    if (!sync.success) {
      return res.status(400).json(sync);
    }

    res.json(sync);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get Tally sync status
 */
export const getTallySyncStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const status = await getOEMTallySyncStatus(id);
    if (!status.success) {
      return res.status(404).json(status);
    }

    res.json(status);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Retry failed Tally sync
 */
export const retryTallySync = async (req, res) => {
  try {
    const { id } = req.params;

    const retry = await retryFailedTallySync(id);
    if (!retry.success) {
      return res.status(400).json(retry);
    }

    res.json(retry);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get brand profitability
 */
export const getBrandProfit = async (req, res) => {
  try {
    const { brandId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required'
      });
    }

    const profitability = await getBrandProfitability(
      brandId,
      new Date(startDate),
      new Date(endDate)
    );

    res.json(profitability);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get cost variance analysis
 */
export const getVarianceAnalysis = async (req, res) => {
  try {
    const { brandId } = req.params;
    const { limit = 10 } = req.query;

    const variance = await getCostVarianceAnalysis(brandId, parseInt(limit));
    if (!variance.success) {
      return res.status(400).json(variance);
    }

    res.json(variance);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Record payment for OEM invoice
 */
export const recordPayment = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { paymentAmount, paymentMethod } = req.body;

    if (!paymentAmount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'paymentAmount and paymentMethod are required'
      });
    }

    const payment = await syncPaymentToTally(invoiceId, paymentAmount, paymentMethod);
    if (!payment.success) {
      return res.status(400).json(payment);
    }

    res.json(payment);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get OEM order full workflow status with all details
 */
export const getFullWorkflowStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const oemOrder = await OEMOrder.findById(id)
      .populate('workOrderId')
      .populate('qcCheckId')
      .populate('finishedGoodsId')
      .populate('brandOrderId')
      .populate('bomId');

    if (!oemOrder) {
      return res.status(404).json({ success: false, message: 'OEM order not found' });
    }

    // Get inventory status
    const inventoryStatus = await getOEMInventoryStatus(id);

    // Get cost breakdown
    const costBreakdown = await getOEMCostBreakdown(id);

    // Get Tally sync status
    const tallySyncStatus = await getOEMTallySyncStatus(id);

    res.json({
      success: true,
      data: {
        order: {
          oemOrderId: oemOrder.oemOrderId,
          product: oemOrder.product,
          quantity: oemOrder.quantity,
          status: oemOrder.status,
          createdAt: oemOrder.createdAt
        },
        workflow: {
          inventory: oemOrder.inventoryStatus,
          production: oemOrder.productionStatus,
          qc: oemOrder.qcStatus,
          dispatch: oemOrder.dispatchStatus,
          billing: oemOrder.billingStatus,
          tally: oemOrder.tallyStatus
        },
        inventory: inventoryStatus.data,
        costs: costBreakdown.data,
        tally: tallySyncStatus.data,
        linkedDocuments: {
          workOrder: oemOrder.workOrderId ? {
            woId: oemOrder.workOrderId.woId,
            status: oemOrder.workOrderId.status
          } : null,
          qc: oemOrder.qcCheckId ? {
            qcId: oemOrder.qcCheckId.qcId,
            status: oemOrder.qcCheckId.status
          } : null,
          finishedGoods: oemOrder.finishedGoodsId ? {
            finishedGoodsId: oemOrder.finishedGoodsId.finishedGoodsId,
            status: oemOrder.finishedGoodsId.status
          } : null
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
