import OEMOrder from '../models/OEMOrder.js';
import OEMBrand from '../models/OEMBrand.js';
import BOM from '../models/BOM.js';
import Inventory from '../models/Inventory.js';

/**
 * Calculate estimated cost for OEM order
 * Material cost + Labor cost + Overhead
 */
export const calculateEstimatedCost = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId)
      .populate('bomId')
      .populate('brandOrderId');

    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    const bom = oemOrder.bomId;
    let materialCost = 0;
    let laborCost = 0;
    let overheadCost = 0;

    // Calculate material cost
    for (const material of bom.materials) {
      const inventory = await Inventory.findOne({
        itemId: material.materialId
      });

      const unitCost = inventory?.unitCost || material.unitCost || 0;
      const qty = material.quantity * oemOrder.quantity;
      materialCost += unitCost * qty;
    }

    // Get brand billing model
    const brand = await OEMBrand.findById(oemOrder.brandOrderId?.oemBrand);
    if (brand) {
      // Calculate labor cost based on billing model
      if (brand.billingType === 'Per Unit') {
        laborCost = brand.ratePerUnit * oemOrder.quantity;
      } else if (brand.billingType === 'Per Order') {
        laborCost = brand.ratePerUnit;
      }
    }

    // Calculate overhead (typically 10-15% of material cost)
    overheadCost = materialCost * 0.12; // 12% overhead

    const estimatedCost = materialCost + laborCost + overheadCost;

    // Update OEM order
    oemOrder.materialCost = materialCost;
    oemOrder.laborCost = laborCost;
    oemOrder.overheadCost = overheadCost;
    oemOrder.estimatedCost = estimatedCost;
    await oemOrder.save();

    console.log(`✅ Estimated cost calculated for OEM Order: ${oemOrder.oemOrderId}`);
    return {
      success: true,
      message: 'Estimated cost calculated',
      data: {
        oemOrderId: oemOrder.oemOrderId,
        materialCost,
        laborCost,
        overheadCost,
        estimatedCost,
        breakdown: {
          material: `${((materialCost / estimatedCost) * 100).toFixed(2)}%`,
          labor: `${((laborCost / estimatedCost) * 100).toFixed(2)}%`,
          overhead: `${((overheadCost / estimatedCost) * 100).toFixed(2)}%`
        }
      }
    };
  } catch (error) {
    console.error('❌ Cost calculation failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Calculate actual cost after production
 * Based on actual material consumption and labor hours
 */
export const calculateActualCost = async (oemOrderId, actualLaborHours = 0) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId)
      .populate('bomId')
      .populate('consumedInventory.inventoryId');

    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    let actualMaterialCost = 0;
    let actualLaborCost = 0;
    let actualOverheadCost = 0;

    // Calculate actual material cost from consumed inventory
    for (const consumed of oemOrder.consumedInventory) {
      const inventory = await Inventory.findById(consumed.inventoryId);
      if (inventory) {
        const unitCost = inventory.unitCost || 0;
        actualMaterialCost += unitCost * consumed.qty;
      }
    }

    // Calculate actual labor cost
    const laborRatePerHour = 500; // Default rate, can be configured
    actualLaborCost = actualLaborHours * laborRatePerHour;

    // Calculate actual overhead
    actualOverheadCost = actualMaterialCost * 0.12; // 12% overhead

    const actualCost = actualMaterialCost + actualLaborCost + actualOverheadCost;

    // Calculate variance
    const estimatedCost = oemOrder.estimatedCost || 0;
    const variance = actualCost - estimatedCost;
    const variancePercentage = estimatedCost > 0 ? ((variance / estimatedCost) * 100).toFixed(2) : 0;

    // Update OEM order
    oemOrder.actualMaterialCost = actualMaterialCost;
    oemOrder.actualLaborCost = actualLaborCost;
    oemOrder.actualOverheadCost = actualOverheadCost;
    oemOrder.actualCost = actualCost;
    await oemOrder.save();

    console.log(`✅ Actual cost calculated for OEM Order: ${oemOrder.oemOrderId}`);
    return {
      success: true,
      message: 'Actual cost calculated',
      data: {
        oemOrderId: oemOrder.oemOrderId,
        actualMaterialCost,
        actualLaborCost,
        actualOverheadCost,
        actualCost,
        estimatedCost,
        variance,
        variancePercentage: `${variancePercentage}%`,
        costBreakdown: {
          material: `${((actualMaterialCost / actualCost) * 100).toFixed(2)}%`,
          labor: `${((actualLaborCost / actualCost) * 100).toFixed(2)}%`,
          overhead: `${((actualOverheadCost / actualCost) * 100).toFixed(2)}%`
        }
      }
    };
  } catch (error) {
    console.error('❌ Actual cost calculation failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Get brand-wise profitability
 */
export const getBrandProfitability = async (brandId, startDate, endDate) => {
  try {
    const orders = await OEMOrder.find({
      'brandOrderId.oemBrand': brandId,
      createdAt: { $gte: startDate, $lte: endDate }
    }).populate('brandOrderId');

    if (orders.length === 0) {
      return {
        success: true,
        data: {
          brandId,
          totalOrders: 0,
          totalRevenue: 0,
          totalCost: 0,
          totalProfit: 0,
          profitMargin: 0
        }
      };
    }

    let totalRevenue = 0;
    let totalCost = 0;
    let completedOrders = 0;

    for (const order of orders) {
      if (order.status === 'Completed' || order.status === 'Invoiced') {
        totalRevenue += order.invoiceAmount || 0;
        totalCost += order.actualCost || order.estimatedCost || 0;
        completedOrders++;
      }
    }

    const totalProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(2) : 0;

    return {
      success: true,
      data: {
        brandId,
        period: {
          startDate,
          endDate
        },
        totalOrders: orders.length,
        completedOrders,
        totalRevenue,
        totalCost,
        totalProfit,
        profitMargin: `${profitMargin}%`,
        averageOrderValue: (totalRevenue / orders.length).toFixed(2),
        averageCostPerOrder: (totalCost / completedOrders).toFixed(2)
      }
    };
  } catch (error) {
    console.error('❌ Profitability calculation failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Get cost variance analysis
 */
export const getCostVarianceAnalysis = async (brandId, limit = 10) => {
  try {
    const orders = await OEMOrder.find({
      'brandOrderId.oemBrand': brandId,
      actualCost: { $exists: true }
    })
      .sort({ createdAt: -1 })
      .limit(limit);

    const variances = orders.map(order => {
      const estimated = order.estimatedCost || 0;
      const actual = order.actualCost || 0;
      const variance = actual - estimated;
      const variancePercentage = estimated > 0 ? ((variance / estimated) * 100).toFixed(2) : 0;

      return {
        oemOrderId: order.oemOrderId,
        estimatedCost: estimated,
        actualCost: actual,
        variance,
        variancePercentage: `${variancePercentage}%`,
        status: variance > 0 ? 'Over Budget' : 'Under Budget'
      };
    });

    const totalVariance = variances.reduce((sum, v) => sum + v.variance, 0);
    const averageVariance = (totalVariance / variances.length).toFixed(2);

    return {
      success: true,
      data: {
        brandId,
        totalOrders: variances.length,
        averageVariance,
        variances
      }
    };
  } catch (error) {
    console.error('❌ Variance analysis failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Get cost breakdown for OEM order
 */
export const getOEMCostBreakdown = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId)
      .populate('bomId')
      .populate('brandOrderId');

    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    const breakdown = {
      oemOrderId: oemOrder.oemOrderId,
      product: oemOrder.product,
      quantity: oemOrder.quantity,
      estimated: {
        materialCost: oemOrder.materialCost || 0,
        laborCost: oemOrder.laborCost || 0,
        overheadCost: oemOrder.overheadCost || 0,
        totalCost: oemOrder.estimatedCost || 0
      },
      actual: {
        materialCost: oemOrder.actualMaterialCost || 0,
        laborCost: oemOrder.actualLaborCost || 0,
        overheadCost: oemOrder.actualOverheadCost || 0,
        totalCost: oemOrder.actualCost || 0
      },
      variance: {
        materialCost: (oemOrder.actualMaterialCost || 0) - (oemOrder.materialCost || 0),
        laborCost: (oemOrder.actualLaborCost || 0) - (oemOrder.laborCost || 0),
        overheadCost: (oemOrder.actualOverheadCost || 0) - (oemOrder.overheadCost || 0),
        totalCost: (oemOrder.actualCost || 0) - (oemOrder.estimatedCost || 0)
      },
      invoice: {
        invoiceNumber: oemOrder.invoiceNumber,
        invoiceAmount: oemOrder.invoiceAmount || 0,
        profitMargin: oemOrder.invoiceAmount ? (((oemOrder.invoiceAmount - (oemOrder.actualCost || 0)) / oemOrder.invoiceAmount) * 100).toFixed(2) : 0
      }
    };

    return {
      success: true,
      data: breakdown
    };
  } catch (error) {
    console.error('❌ Cost breakdown failed:', error.message);
    return { success: false, message: error.message };
  }
};
