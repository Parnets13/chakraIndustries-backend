import OEMOrder from '../models/OEMOrder.js';
import OEMInvoice from '../models/OEMInvoice.js';
import OEMBrand from '../models/OEMBrand.js';
import TallySyncLog from '../models/TallySyncLog.js';
import axios from 'axios';

const TALLY_API_URL = process.env.TALLY_API_URL || 'http://localhost:9000/api';

/**
 * Sync OEM Order to Tally
 * Creates stock journal entry and updates brand ledger
 */
export const syncOEMOrderToTally = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId)
      .populate('brandOrderId')
      .populate('bomId');

    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    if (oemOrder.tallyStatus === 'Synced') {
      return { success: false, message: 'Already synced to Tally' };
    }

    // Create stock journal entry for finished goods
    const journalEntry = {
      voucherType: 'Journal',
      voucherDate: new Date().toISOString().split('T')[0],
      referenceNumber: oemOrder.oemOrderId,
      narration: `Manufacturing - ${oemOrder.product} for ${oemOrder.brandOrderId?.brandName || 'Brand'}`,
      entries: [
        {
          ledgerName: 'Finished Goods',
          amount: oemOrder.actualCost || oemOrder.estimatedCost,
          debit: true
        },
        {
          ledgerName: 'Manufacturing Overhead',
          amount: oemOrder.overheadCost || 0,
          debit: true
        },
        {
          ledgerName: 'Raw Materials',
          amount: oemOrder.materialCost || 0,
          debit: false
        },
        {
          ledgerName: 'Labor Cost',
          amount: oemOrder.laborCost || 0,
          debit: false
        }
      ]
    };

    // Send to Tally
    const tallyResponse = await axios.post(
      `${TALLY_API_URL}/vouchers/create`,
      journalEntry,
      { timeout: 10000 }
    );

    if (!tallyResponse.data.success) {
      throw new Error(tallyResponse.data.message || 'Tally sync failed');
    }

    // Update OEM order with Tally reference
    oemOrder.tallyDocumentId = tallyResponse.data.data.voucherId;
    oemOrder.tallyReference = tallyResponse.data.data.referenceNumber;
    oemOrder.tallyStatus = 'Synced';
    await oemOrder.save();

    // Log sync
    await TallySyncLog.create({
      entityType: 'OEMOrder',
      entityId: oemOrder._id,
      entityNumber: oemOrder.oemOrderId,
      tallyDocumentId: tallyResponse.data.data.voucherId,
      status: 'Success',
      syncedAt: new Date()
    });

    console.log(`✅ OEM Order synced to Tally: ${oemOrder.oemOrderId}`);
    return { success: true, message: 'OEM order synced to Tally', data: oemOrder };
  } catch (error) {
    console.error('❌ OEM Tally sync failed:', error.message);

    // Log failure
    await TallySyncLog.create({
      entityType: 'OEMOrder',
      entityId: oemOrderId,
      status: 'Failed',
      errorMessage: error.message,
      syncedAt: new Date()
    });

    return { success: false, message: error.message };
  }
};

/**
 * Sync OEM Invoice to Tally
 * Creates sales voucher and updates brand ledger
 */
export const syncOEMInvoiceToTally = async (invoiceId) => {
  try {
    const invoice = await OEMInvoice.findById(invoiceId)
      .populate('oemOrderId')
      .populate('brandOrderId');

    if (!invoice) {
      return { success: false, message: 'Invoice not found' };
    }

    if (invoice.tallyStatus === 'Synced') {
      return { success: false, message: 'Already synced to Tally' };
    }

    // Create sales voucher
    const salesVoucher = {
      voucherType: 'Sales',
      voucherDate: invoice.invoiceDate.toISOString().split('T')[0],
      referenceNumber: invoice.invoiceNumber,
      narration: `OEM Manufacturing Invoice - ${invoice.product}`,
      entries: [
        {
          ledgerName: 'Accounts Receivable',
          amount: invoice.totalAmount,
          debit: true
        },
        {
          ledgerName: 'Sales Revenue',
          amount: invoice.subtotal,
          debit: false
        },
        {
          ledgerName: 'GST Output',
          amount: invoice.taxAmount,
          debit: false
        }
      ]
    };

    // Send to Tally
    const tallyResponse = await axios.post(
      `${TALLY_API_URL}/vouchers/create`,
      salesVoucher,
      { timeout: 10000 }
    );

    if (!tallyResponse.data.success) {
      throw new Error(tallyResponse.data.message || 'Tally sync failed');
    }

    // Update invoice with Tally reference
    invoice.tallyDocumentId = tallyResponse.data.data.voucherId;
    invoice.tallyStatus = 'Synced';
    await invoice.save();

    // Log sync
    await TallySyncLog.create({
      entityType: 'OEMInvoice',
      entityId: invoice._id,
      entityNumber: invoice.invoiceNumber,
      tallyDocumentId: tallyResponse.data.data.voucherId,
      status: 'Success',
      syncedAt: new Date()
    });

    console.log(`✅ OEM Invoice synced to Tally: ${invoice.invoiceNumber}`);
    return { success: true, message: 'Invoice synced to Tally', data: invoice };
  } catch (error) {
    console.error('❌ Invoice Tally sync failed:', error.message);

    // Log failure
    await TallySyncLog.create({
      entityType: 'OEMInvoice',
      entityId: invoiceId,
      status: 'Failed',
      errorMessage: error.message,
      syncedAt: new Date()
    });

    return { success: false, message: error.message };
  }
};

/**
 * Update Brand Ledger in Tally
 * Records brand-wise revenue and charges
 */
export const updateBrandLedgerInTally = async (brandId, amount, type = 'revenue') => {
  try {
    const brand = await OEMBrand.findById(brandId);
    if (!brand) {
      return { success: false, message: 'Brand not found' };
    }

    const ledgerEntry = {
      ledgerName: `Brand - ${brand.name}`,
      amount,
      type, // 'revenue', 'charge', 'payment'
      date: new Date().toISOString().split('T')[0],
      narration: `${type === 'revenue' ? 'Revenue' : 'Charge'} for ${brand.name}`
    };

    // Send to Tally
    const tallyResponse = await axios.post(
      `${TALLY_API_URL}/ledgers/update`,
      ledgerEntry,
      { timeout: 10000 }
    );

    if (!tallyResponse.data.success) {
      throw new Error(tallyResponse.data.message || 'Ledger update failed');
    }

    console.log(`✅ Brand ledger updated in Tally: ${brand.name}`);
    return { success: true, message: 'Brand ledger updated', data: tallyResponse.data.data };
  } catch (error) {
    console.error('❌ Brand ledger update failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Sync Payment to Tally
 * Records payment against OEM invoice
 */
export const syncPaymentToTally = async (invoiceId, paymentAmount, paymentMethod) => {
  try {
    const invoice = await OEMInvoice.findById(invoiceId);
    if (!invoice) {
      return { success: false, message: 'Invoice not found' };
    }

    const paymentVoucher = {
      voucherType: 'Payment',
      voucherDate: new Date().toISOString().split('T')[0],
      referenceNumber: `PAY-${invoice.invoiceNumber}`,
      narration: `Payment for OEM Invoice ${invoice.invoiceNumber}`,
      entries: [
        {
          ledgerName: 'Bank Account',
          amount: paymentAmount,
          debit: false
        },
        {
          ledgerName: 'Accounts Receivable',
          amount: paymentAmount,
          debit: true
        }
      ]
    };

    // Send to Tally
    const tallyResponse = await axios.post(
      `${TALLY_API_URL}/vouchers/create`,
      paymentVoucher,
      { timeout: 10000 }
    );

    if (!tallyResponse.data.success) {
      throw new Error(tallyResponse.data.message || 'Payment sync failed');
    }

    // Update invoice payment status
    invoice.amountPaid = (invoice.amountPaid || 0) + paymentAmount;
    invoice.paymentDate = new Date();
    invoice.paymentMethod = paymentMethod;
    invoice.paymentStatus = invoice.amountPaid >= invoice.totalAmount ? 'Paid' : 'Partial';
    await invoice.save();

    console.log(`✅ Payment synced to Tally: ${invoice.invoiceNumber}`);
    return { success: true, message: 'Payment synced to Tally', data: invoice };
  } catch (error) {
    console.error('❌ Payment sync failed:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Get OEM Tally Sync Status
 */
export const getOEMTallySyncStatus = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId);
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    const syncLogs = await TallySyncLog.find({
      entityId: oemOrderId
    }).sort({ syncedAt: -1 }).limit(10);

    return {
      success: true,
      data: {
        oemOrder: {
          oemOrderId: oemOrder.oemOrderId,
          tallyStatus: oemOrder.tallyStatus,
          tallyDocumentId: oemOrder.tallyDocumentId,
          tallyReference: oemOrder.tallyReference,
          tallyError: oemOrder.tallyError
        },
        syncHistory: syncLogs
      }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

/**
 * Retry Failed Tally Sync
 */
export const retryFailedTallySync = async (oemOrderId) => {
  try {
    const oemOrder = await OEMOrder.findById(oemOrderId);
    if (!oemOrder) {
      return { success: false, message: 'OEM order not found' };
    }

    if (oemOrder.tallyStatus === 'Synced') {
      return { success: false, message: 'Already synced' };
    }

    // Reset status and retry
    oemOrder.tallyStatus = 'Pending';
    oemOrder.tallyError = null;
    await oemOrder.save();

    // Trigger sync
    return await syncOEMOrderToTally(oemOrderId);
  } catch (error) {
    return { success: false, message: error.message };
  }
};
