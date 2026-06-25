import AccountsPayable from '../models/AccountsPayable.js';
import AccountsReceivable from '../models/AccountsReceivable.js';
import SupplierPayment from '../models/SupplierPayment.js';
import DealerReceipt from '../models/DealerReceipt.js';
import Vendor from '../models/Vendor.js';
import Invoice from '../models/Invoice.js';
import BankAccount from '../models/BankAccount.js';
import CreditNote from '../models/CreditNote.js';
import DebitNote from '../models/DebitNote.js';
import TallyVoucher from '../models/TallyVoucher.js';

export const getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      totalAccountsPayable,
      totalAccountsReceivable,
      paymentsMadeToday,
      paymentsReceivedToday,
      overdueSupplierInvoices,
      overdueDealerInvoices,
      recentPayments,
      recentReceipts
    ] = await Promise.all([
      AccountsPayable.aggregate([{ $group: { _id: null, total: { $sum: '$balanceAmount' } } }]),
      AccountsReceivable.aggregate([{ $group: { _id: null, total: { $sum: '$balanceAmount' } } }]),
      SupplierPayment.countDocuments({ paymentDate: { $gte: today, $lt: tomorrow } }),
      DealerReceipt.countDocuments({ receiptDate: { $gte: today, $lt: tomorrow } }),
      AccountsPayable.countDocuments({ dueDate: { $lt: today }, paymentStatus: { $ne: 'Paid' } }),
      AccountsReceivable.countDocuments({ dueDate: { $lt: today }, paymentStatus: { $ne: 'Paid' } }),
      SupplierPayment.find().sort({ createdAt: -1 }).limit(5).populate('supplier'),
      DealerReceipt.find().sort({ createdAt: -1 }).limit(5).populate('dealer')
    ]);

    const recentTransactions = [
      ...recentPayments.map(p => ({
        id: p._id.toString(),
        type: 'Payment',
        party: p.supplier?.companyName || 'Unknown',
        amount: -p.paymentAmount,
        date: p.paymentDate ? new Date(p.paymentDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        status: 'Completed'
      })),
      ...recentReceipts.map(r => ({
        id: r._id.toString(),
        type: 'Receipt',
        party: r.dealer?.businessName || r.dealer?.name || 'Unknown',
        amount: r.receiptAmount,
        date: r.receiptDate ? new Date(r.receiptDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        status: 'Completed'
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

    const stats = {
      totalAccountsPayable: totalAccountsPayable[0]?.total || 0,
      totalAccountsReceivable: totalAccountsReceivable[0]?.total || 0,
      totalSupplierOutstanding: totalAccountsPayable[0]?.total || 0,
      totalDealerOutstanding: totalAccountsReceivable[0]?.total || 0,
      paymentsMadeToday,
      paymentsReceivedToday,
      overdueSupplierInvoices,
      overdueDealerInvoices,
      recentTransactions
    };

    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getRecentTransactions = async (req, res) => {
  try {
    const [payments, receipts] = await Promise.all([
      SupplierPayment.find().sort({ createdAt: -1 }).limit(20).populate('supplier'),
      DealerReceipt.find().sort({ createdAt: -1 }).limit(20).populate('dealer')
    ]);

    const transactions = [
      ...payments.map(p => ({
        id: p._id.toString(),
        type: 'Payment',
        party: p.supplier?.companyName || 'Unknown',
        amount: -p.paymentAmount,
        date: p.paymentDate ? new Date(p.paymentDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        status: 'Completed'
      })),
      ...receipts.map(r => ({
        id: r._id.toString(),
        type: 'Receipt',
        party: r.dealer?.businessName || r.dealer?.name || 'Unknown',
        amount: r.receiptAmount,
        date: r.receiptDate ? new Date(r.receiptDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        status: 'Completed'
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ success: true, data: transactions });
  } catch (err) {
    console.error('getRecentTransactions error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAccountsPayable = async (req, res) => {
  try {
    const { supplierId, paymentStatus, search, page, limit } = req.query;
    const filter = {};
    if (supplierId) filter.supplier = supplierId;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    const pageNum  = parseInt(page)  || 0;
    const limitNum = parseInt(limit) || 0;
    const usePagination = pageNum > 0 && limitNum > 0;
    const skip = usePagination ? (pageNum - 1) * limitNum : 0;

    const [accountsPayable, totalCount] = await Promise.all([
      AccountsPayable.find(filter)
        .sort({ createdAt: -1 })
        .skip(usePagination ? skip : 0)
        .limit(usePagination ? limitNum : 0)
        .populate('supplier')
        .populate('purchaseOrder')
        .populate('poInvoice'),
      usePagination ? AccountsPayable.countDocuments(filter) : Promise.resolve(null),
    ]);

    const formattedData = accountsPayable.map(ap => ({
      id: ap._id.toString(),
      supplierName: ap.supplier?.companyName || 'Unknown',
      invoiceNumber: ap.invoiceNumber,
      invoiceAmount: ap.invoiceAmount,
      paidAmount: ap.paidAmount,
      balanceAmount: ap.balanceAmount,
      dueDate: ap.dueDate ? new Date(ap.dueDate).toISOString().split('T')[0] : null,
      paymentStatus: ap.paymentStatus
    }));

    const response = { success: true, data: formattedData };
    if (usePagination) {
      response.pagination = {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
      };
    }
    res.json(response);
  } catch (err) {
    console.error('getAccountsPayable error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createAccountsPayable = async (req, res) => {
  try {
    const accountsPayable = await AccountsPayable.create(req.body);
    await accountsPayable.populate('supplier');
    await accountsPayable.populate('purchaseOrder');
    await accountsPayable.populate('poInvoice');
    res.status(201).json({ success: true, data: accountsPayable });
  } catch (err) {
    console.error('createAccountsPayable error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateAccountsPayable = async (req, res) => {
  try {
    const accountsPayable = await AccountsPayable.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('supplier').populate('purchaseOrder').populate('poInvoice');
    if (!accountsPayable) {
      return res.status(404).json({ success: false, message: 'Accounts Payable not found' });
    }
    res.json({ success: true, data: accountsPayable });
  } catch (err) {
    console.error('updateAccountsPayable error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getAccountsReceivable = async (req, res) => {
  try {
    const { dealerId, paymentStatus, search, page, limit } = req.query;
    const filter = {};
    if (dealerId) filter.dealer = dealerId;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    const pageNum  = parseInt(page)  || 0;
    const limitNum = parseInt(limit) || 0;
    const usePagination = pageNum > 0 && limitNum > 0;
    const skip = usePagination ? (pageNum - 1) * limitNum : 0;

    const [accountsReceivable, totalCount] = await Promise.all([
      AccountsReceivable.find(filter)
        .sort({ createdAt: -1 })
        .skip(usePagination ? skip : 0)
        .limit(usePagination ? limitNum : 0)
        .populate('dealer')
        .populate('salesOrder')
        .populate('invoice'),
      usePagination ? AccountsReceivable.countDocuments(filter) : Promise.resolve(null),
    ]);

    // ── Primary path: AccountsReceivable records exist ────────────────────────
    if (accountsReceivable.length > 0) {
      const formattedData = accountsReceivable.map(ar => ({
        id: ar._id.toString(),
        dealerName: ar.dealer?.businessName || ar.dealer?.name || 'Unknown',
        invoiceNumber: ar.invoiceNumber,
        invoiceAmount: ar.invoiceAmount || ar.invoice?.grandTotal || 0,
        paidAmount: ar.paidAmount || 0,
        balanceAmount: ar.balanceAmount || Math.max(0, (ar.invoiceAmount || ar.invoice?.grandTotal || 0) - (ar.paidAmount || 0)),
        dueDate: ar.dueDate ? new Date(ar.dueDate).toISOString().split('T')[0] : null,
        paymentStatus: ar.paymentStatus,
        source: 'ERP',
      }));

      const response = { success: true, data: formattedData };
      if (usePagination) {
        response.pagination = {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalCount / limitNum),
        };
      }
      return res.json(response);
    }

    // ── Fallback: No AR records → pull from Tally-synced Invoices (Sales vouchers) ──
    // This ensures the Accounts Receivable tab shows real data from Tally
    // even when no AR records have been manually created in the ERP.
    const invoiceFilter = { source: { $in: ['Tally', 'tally'] } };
    if (search) {
      const re = new RegExp(search, 'i');
      invoiceFilter.$or = [{ partyName: re }, { invoiceNo: re }];
    }

    const tallyInvoices = await Invoice.find(invoiceFilter)
      .sort({ invoiceDate: -1 })
      .limit(usePagination ? limitNum : 500)
      .skip(usePagination ? skip : 0)
      .lean();

    const tallyTotal = usePagination
      ? await Invoice.countDocuments(invoiceFilter)
      : null;

    const formattedData = tallyInvoices.map(inv => {
      const invoiceAmount = inv.grandTotal || 0;
      const paidAmount    = inv.paidAmount  || 0;
      const balanceAmount = Math.max(0, invoiceAmount - paidAmount);
      const payStatus =
        paidAmount <= 0           ? 'Unpaid'
        : paidAmount >= invoiceAmount ? 'Paid'
        : 'Partially Paid';

      return {
        id:            inv._id.toString(),
        dealerName:    inv.partyName || 'Unknown',
        invoiceNumber: inv.invoiceNo || inv.tallyVoucherNumber || '—',
        invoiceAmount,
        paidAmount,
        balanceAmount,
        dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().split('T')[0] : null,
        paymentStatus: payStatus,
        source: 'Tally',
      };
    });

    const response = { success: true, data: formattedData };
    if (usePagination) {
      response.pagination = {
        total: tallyTotal,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(tallyTotal / limitNum),
      };
    }
    return res.json(response);
  } catch (err) {
    console.error('getAccountsReceivable error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createAccountsReceivable = async (req, res) => {
  try {
    const accountsReceivable = await AccountsReceivable.create(req.body);
    await accountsReceivable.populate('dealer');
    await accountsReceivable.populate('salesOrder');
    await accountsReceivable.populate('invoice');
    res.status(201).json({ success: true, data: accountsReceivable });
  } catch (err) {
    console.error('createAccountsReceivable error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateAccountsReceivable = async (req, res) => {
  try {
    const accountsReceivable = await AccountsReceivable.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('dealer').populate('salesOrder').populate('invoice');
    if (!accountsReceivable) {
      return res.status(404).json({ success: false, message: 'Accounts Receivable not found' });
    }
    res.json({ success: true, data: accountsReceivable });
  } catch (err) {
    console.error('updateAccountsReceivable error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getSupplierPayments = async (req, res) => {
  try {
    const { supplierId, page, limit } = req.query;
    const filter = {};
    if (supplierId) filter.supplier = supplierId;

    const [payments, tallyPayments] = await Promise.all([
      SupplierPayment.find(filter).sort({ createdAt: -1 }).populate('supplier').populate('accountsPayable'),
      TallyVoucher.find({ voucherType: 'Payment' }).sort({ voucherDate: -1 }).limit(500),
    ]);

    const erpRows = payments.map(p => ({
      id: p._id.toString(),
      supplierName: p.supplier?.companyName || 'Unknown',
      invoiceNumber: p.accountsPayable?.invoiceNumber || '—',
      amount: p.paymentAmount,
      date: p.paymentDate ? new Date(p.paymentDate).toISOString().split('T')[0] : new Date(p.createdAt).toISOString().split('T')[0],
      paymentMethod: p.paymentMethod || 'Other',
      status: 'Completed',
      source: 'ERP',
    }));

    const tallyRows = tallyPayments.map(v => ({
      id: v._id.toString(),
      supplierName: v.partyName || v.partyLedgerName || 'Unknown',
      invoiceNumber: v.voucherNumber || '—',
      amount: v.amount,
      date: v.voucherDate ? new Date(v.voucherDate).toISOString().split('T')[0] : new Date(v.syncedAt).toISOString().split('T')[0],
      paymentMethod: 'Tally',
      status: 'Completed',
      source: 'Tally',
      narration: v.narration || '',
    }));

    const merged = [...erpRows, ...tallyRows].sort((a, b) => new Date(b.date) - new Date(a.date));

    const pageNum  = parseInt(page)  || 0;
    const limitNum = parseInt(limit) || 0;
    const usePagination = pageNum > 0 && limitNum > 0;

    const response = { success: true };
    if (usePagination) {
      const total = merged.length;
      const skip  = (pageNum - 1) * limitNum;
      response.data = merged.slice(skip, skip + limitNum);
      response.pagination = {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      };
    } else {
      response.data = merged;
    }
    res.json(response);
  } catch (err) {
    console.error('getSupplierPayments error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createSupplierPayment = async (req, res) => {
  try {
    const payment = await SupplierPayment.create(req.body);
    const accountsPayable = await AccountsPayable.findById(payment.accountsPayable);
    if (accountsPayable) {
      accountsPayable.paidAmount += payment.paymentAmount;
      await accountsPayable.save();
    }
    await payment.populate('supplier');
    await payment.populate('accountsPayable');
    res.status(201).json({ success: true, data: payment });
  } catch (err) {
    console.error('createSupplierPayment error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getDealerReceipts = async (req, res) => {
  try {
    const { dealerId, page, limit } = req.query;
    const filter = {};
    if (dealerId) filter.dealer = dealerId;

    const [receipts, tallyReceipts] = await Promise.all([
      DealerReceipt.find(filter).sort({ createdAt: -1 }).populate('dealer').populate('accountsReceivable'),
      TallyVoucher.find({ voucherType: 'Receipt' }).sort({ voucherDate: -1 }).limit(500),
    ]);

    const erpRows = receipts.map(r => ({
      id: r._id.toString(),
      dealerName: r.dealer?.businessName || r.dealer?.name || 'Unknown',
      invoiceNumber: r.accountsReceivable?.invoiceNumber || '—',
      amount: r.receiptAmount,
      date: r.receiptDate ? new Date(r.receiptDate).toISOString().split('T')[0] : new Date(r.createdAt).toISOString().split('T')[0],
      paymentMethod: r.paymentMethod || 'Other',
      status: 'Completed',
      source: 'ERP',
    }));

    const tallyRows = tallyReceipts.map(v => ({
      id: v._id.toString(),
      dealerName: v.partyName || v.partyLedgerName || 'Unknown',
      invoiceNumber: v.voucherNumber || '—',
      amount: v.amount,
      date: v.voucherDate ? new Date(v.voucherDate).toISOString().split('T')[0] : new Date(v.syncedAt).toISOString().split('T')[0],
      paymentMethod: 'Tally',
      status: 'Completed',
      source: 'Tally',
      narration: v.narration || '',
    }));

    const merged = [...erpRows, ...tallyRows].sort((a, b) => new Date(b.date) - new Date(a.date));

    const pageNum  = parseInt(page)  || 0;
    const limitNum = parseInt(limit) || 0;
    const usePagination = pageNum > 0 && limitNum > 0;

    const response = { success: true };
    if (usePagination) {
      const total = merged.length;
      const skip  = (pageNum - 1) * limitNum;
      response.data = merged.slice(skip, skip + limitNum);
      response.pagination = {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      };
    } else {
      response.data = merged;
    }
    res.json(response);
  } catch (err) {
    console.error('getDealerReceipts error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createDealerReceipt = async (req, res) => {
  try {
    const receipt = await DealerReceipt.create(req.body);
    const accountsReceivable = await AccountsReceivable.findById(receipt.accountsReceivable);
    if (accountsReceivable) {
      accountsReceivable.paidAmount += receipt.receiptAmount;
      await accountsReceivable.save();
      const invoice = await Invoice.findById(accountsReceivable.invoice);
      if (invoice) {
        invoice.paidAmount += receipt.receiptAmount;
        await invoice.save();
      }
    }
    await receipt.populate('dealer');
    await receipt.populate('accountsReceivable');
    res.status(201).json({ success: true, data: receipt });
  } catch (err) {
    console.error('createDealerReceipt error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getSupplierLedger = async (req, res) => {
  try {
    const { supplierId } = req.query;
    const filter = {};
    if (supplierId) filter.supplier = supplierId;

    const [accountsPayable, payments, tallyPayments, tallyPurchases] = await Promise.all([
      AccountsPayable.find(filter).sort({ createdAt: 1 }).populate('supplier'),
      SupplierPayment.find(filter).sort({ createdAt: 1 }).populate('supplier'),
      TallyVoucher.find({ voucherType: 'Payment' }).sort({ voucherDate: 1 }).limit(500),
      TallyVoucher.find({ voucherType: 'Purchase' }).sort({ voucherDate: 1 }).limit(500),
    ]);

    const ledger = [];
    let balance = 0;

    accountsPayable.forEach(ap => {
      const date = ap.invoiceDate ? new Date(ap.invoiceDate).toISOString().split('T')[0] : new Date(ap.createdAt).toISOString().split('T')[0];
      balance += ap.invoiceAmount;
      ledger.push({ id: ap._id.toString(), date, type: 'Invoice', reference: ap.invoiceNumber, debit: ap.invoiceAmount, credit: 0, balance, source: 'ERP' });
    });

    payments.forEach(p => {
      const date = p.paymentDate ? new Date(p.paymentDate).toISOString().split('T')[0] : new Date(p.createdAt).toISOString().split('T')[0];
      balance -= p.paymentAmount;
      ledger.push({ id: p._id.toString(), date, type: 'Payment', reference: p._id.toString(), debit: 0, credit: p.paymentAmount, balance, source: 'ERP' });
    });

    // Merge Tally purchase vouchers as invoices
    tallyPurchases.forEach(v => {
      const date = v.voucherDate ? new Date(v.voucherDate).toISOString().split('T')[0] : new Date(v.syncedAt).toISOString().split('T')[0];
      balance += v.amount;
      ledger.push({ id: v._id.toString(), date, type: 'Invoice', reference: v.voucherNumber || v._id.toString(), debit: v.amount, credit: 0, balance, source: 'Tally', party: v.partyName });
    });

    // Merge Tally payment vouchers
    tallyPayments.forEach(v => {
      const date = v.voucherDate ? new Date(v.voucherDate).toISOString().split('T')[0] : new Date(v.syncedAt).toISOString().split('T')[0];
      balance -= v.amount;
      ledger.push({ id: v._id.toString(), date, type: 'Payment', reference: v.voucherNumber || v._id.toString(), debit: 0, credit: v.amount, balance, source: 'Tally', party: v.partyName });
    });

    ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
    // Recompute running balance after sort
    let running = 0;
    ledger.forEach(row => {
      running += row.debit - row.credit;
      row.balance = running;
    });

    res.json({ success: true, data: ledger });
  } catch (err) {
    console.error('getSupplierLedger error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getDealerLedger = async (req, res) => {
  try {
    const { dealerId } = req.query;
    const filter = {};
    if (dealerId) filter.dealer = dealerId;

    const [accountsReceivable, receipts, tallySales, tallyReceipts] = await Promise.all([
      AccountsReceivable.find(filter).sort({ createdAt: 1 }).populate('dealer'),
      DealerReceipt.find(filter).sort({ createdAt: 1 }).populate('dealer'),
      TallyVoucher.find({ voucherType: 'Sales' }).sort({ voucherDate: 1 }).limit(500),
      TallyVoucher.find({ voucherType: 'Receipt' }).sort({ voucherDate: 1 }).limit(500),
    ]);

    const ledger = [];

    accountsReceivable.forEach(ar => {
      const date = ar.invoiceDate ? new Date(ar.invoiceDate).toISOString().split('T')[0] : new Date(ar.createdAt).toISOString().split('T')[0];
      ledger.push({ id: ar._id.toString(), date, type: 'Invoice', reference: ar.invoiceNumber, debit: 0, credit: ar.invoiceAmount, balance: 0, source: 'ERP' });
    });

    receipts.forEach(r => {
      const date = r.receiptDate ? new Date(r.receiptDate).toISOString().split('T')[0] : new Date(r.createdAt).toISOString().split('T')[0];
      ledger.push({ id: r._id.toString(), date, type: 'Receipt', reference: r._id.toString(), debit: r.receiptAmount, credit: 0, balance: 0, source: 'ERP' });
    });

    // Merge Tally sales vouchers as invoices
    tallySales.forEach(v => {
      const date = v.voucherDate ? new Date(v.voucherDate).toISOString().split('T')[0] : new Date(v.syncedAt).toISOString().split('T')[0];
      ledger.push({ id: v._id.toString(), date, type: 'Invoice', reference: v.voucherNumber || v._id.toString(), debit: 0, credit: v.amount, balance: 0, source: 'Tally', party: v.partyName });
    });

    // Merge Tally receipt vouchers
    tallyReceipts.forEach(v => {
      const date = v.voucherDate ? new Date(v.voucherDate).toISOString().split('T')[0] : new Date(v.syncedAt).toISOString().split('T')[0];
      ledger.push({ id: v._id.toString(), date, type: 'Receipt', reference: v.voucherNumber || v._id.toString(), debit: v.amount, credit: 0, balance: 0, source: 'Tally', party: v.partyName });
    });

    ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Compute running balance after sort
    let running = 0;
    ledger.forEach(row => {
      running += row.credit - row.debit;
      row.balance = running;
    });

    res.json({ success: true, data: ledger });
  } catch (err) {
    console.error('getDealerLedger error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getOutstandingInvoices = async (req, res) => {
  try {
    const { type } = req.query;
    const invoices = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (type === 'payable' || !type) {
      const payables = await AccountsPayable.find({ paymentStatus: { $ne: 'Paid' } })
        .sort({ createdAt: -1 }).populate('supplier');
      payables.forEach(p => {
        const dueDate = p.dueDate ? new Date(p.dueDate) : null;
        const daysOverdue = dueDate ? Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)) : 0;
        invoices.push({
          id: p._id.toString(),
          type: 'Payable',
          partyName: p.supplier?.companyName || 'Unknown',
          invoiceNumber: p.invoiceNumber,
          invoiceAmount: p.invoiceAmount,
          paidAmount: p.paidAmount,
          balanceAmount: p.balanceAmount,
          dueDate: dueDate ? dueDate.toISOString().split('T')[0] : null,
          daysOverdue
        });
      });
    }

    if (type === 'receivable' || !type) {
      const receivables = await AccountsReceivable.find({ paymentStatus: { $ne: 'Paid' } })
        .sort({ createdAt: -1 }).populate('dealer').populate('invoice');
      receivables.forEach(r => {
        const dueDate = r.dueDate ? new Date(r.dueDate) : null;
        const daysOverdue = dueDate ? Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)) : 0;
        invoices.push({
          id: r._id.toString(),
          type: 'Receivable',
          partyName: r.dealer?.businessName || r.dealer?.name || 'Unknown',
          invoiceNumber: r.invoiceNumber,
          invoiceAmount: r.invoiceAmount,
          paidAmount: r.paidAmount,
          balanceAmount: r.balanceAmount,
          dueDate: dueDate ? dueDate.toISOString().split('T')[0] : null,
          daysOverdue
        });
      });
    }

    res.json({ success: true, data: invoices });
  } catch (err) {
    console.error('getOutstandingInvoices error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getBankCashAccounts = async (req, res) => {
  try {
    const accounts = await BankAccount.find().sort({ createdAt: -1 });
    const formattedData = accounts.map(a => ({
      id: a._id.toString(),
      accountName: a.accountName,
      accountNumber: a.accountNumber || '—',
      type: a.type,
      balance: a.balance
    }));
    res.json({ success: true, data: formattedData });
  } catch (err) {
    console.error('getBankCashAccounts error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createBankCashAccount = async (req, res) => {
  try {
    const account = await BankAccount.create(req.body);
    res.status(201).json({ success: true, data: account });
  } catch (err) {
    console.error('createBankCashAccount error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getPaymentHistory = async (req, res) => {
  try {
    const [payments, receipts, tallyPayments, tallyReceipts, tallyJournals, tallyContras] = await Promise.all([
      SupplierPayment.find().sort({ createdAt: -1 }).populate('supplier'),
      DealerReceipt.find().sort({ createdAt: -1 }).populate('dealer'),
      TallyVoucher.find({ voucherType: 'Payment' }).sort({ voucherDate: -1 }).limit(500),
      TallyVoucher.find({ voucherType: 'Receipt' }).sort({ voucherDate: -1 }).limit(500),
      TallyVoucher.find({ voucherType: 'Journal' }).sort({ voucherDate: -1 }).limit(200),
      TallyVoucher.find({ voucherType: 'Contra' }).sort({ voucherDate: -1 }).limit(200),
    ]);

    const history = [
      ...payments.map(p => ({
        id: p._id.toString(),
        date: p.paymentDate ? new Date(p.paymentDate).toISOString().split('T')[0] : new Date(p.createdAt).toISOString().split('T')[0],
        type: 'Payment',
        party: p.supplier?.companyName || 'Unknown',
        reference: p._id.toString(),
        amount: p.paymentAmount,
        method: p.paymentMethod || 'Other',
        status: 'Completed',
        source: 'ERP',
      })),
      ...receipts.map(r => ({
        id: r._id.toString(),
        date: r.receiptDate ? new Date(r.receiptDate).toISOString().split('T')[0] : new Date(r.createdAt).toISOString().split('T')[0],
        type: 'Receipt',
        party: r.dealer?.businessName || r.dealer?.name || 'Unknown',
        reference: r._id.toString(),
        amount: r.receiptAmount,
        method: r.paymentMethod || 'Other',
        status: 'Completed',
        source: 'ERP',
      })),
      ...tallyPayments.map(v => ({
        id: v._id.toString(),
        date: v.voucherDate ? new Date(v.voucherDate).toISOString().split('T')[0] : new Date(v.syncedAt).toISOString().split('T')[0],
        type: 'Payment',
        party: v.partyName || v.partyLedgerName || 'Unknown',
        reference: v.voucherNumber || v._id.toString(),
        amount: v.amount,
        method: 'Tally',
        status: 'Completed',
        source: 'Tally',
        narration: v.narration || '',
      })),
      ...tallyReceipts.map(v => ({
        id: v._id.toString(),
        date: v.voucherDate ? new Date(v.voucherDate).toISOString().split('T')[0] : new Date(v.syncedAt).toISOString().split('T')[0],
        type: 'Receipt',
        party: v.partyName || v.partyLedgerName || 'Unknown',
        reference: v.voucherNumber || v._id.toString(),
        amount: v.amount,
        method: 'Tally',
        status: 'Completed',
        source: 'Tally',
        narration: v.narration || '',
      })),
      ...tallyJournals.map(v => ({
        id: v._id.toString(),
        date: v.voucherDate ? new Date(v.voucherDate).toISOString().split('T')[0] : new Date(v.syncedAt).toISOString().split('T')[0],
        type: 'Journal',
        party: v.partyName || v.partyLedgerName || '—',
        reference: v.voucherNumber || v._id.toString(),
        amount: v.amount,
        method: 'Tally',
        status: 'Completed',
        source: 'Tally',
        narration: v.narration || '',
      })),
      ...tallyContras.map(v => ({
        id: v._id.toString(),
        date: v.voucherDate ? new Date(v.voucherDate).toISOString().split('T')[0] : new Date(v.syncedAt).toISOString().split('T')[0],
        type: 'Contra',
        party: v.partyName || v.partyLedgerName || '—',
        reference: v.voucherNumber || v._id.toString(),
        amount: v.amount,
        method: 'Tally',
        status: 'Completed',
        source: 'Tally',
        narration: v.narration || '',
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ success: true, data: history });
  } catch (err) {
    console.error('getPaymentHistory error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getFinancialReports = async (req, res) => {
  try {
    const { type } = req.params;
    const report = { type, data: {} };
    res.json({ success: true, data: report });
  } catch (err) {
    console.error('getFinancialReports error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getVendorCreditNotes = async (req, res) => {
  try {
    const { vendorId } = req.query;
    const filter = {};
    if (vendorId) filter.vendorId = vendorId;
    const creditNotes = await CreditNote.find(filter)
      .sort({ createdAt: -1 })
      .populate('vendorId');

    const calcDaysOpen = (createdAt) =>
      Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));

    const formattedData = creditNotes.map(cn => ({
      ...cn.toObject(),
      daysOpen: calcDaysOpen(cn.createdAt),
    }));
    res.json({ success: true, data: formattedData });
  } catch (err) {
    console.error('getVendorCreditNotes error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getVendorDebitNotes = async (req, res) => {
  try {
    const { vendorId } = req.query;
    const filter = {};
    if (vendorId) filter.vendorId = vendorId;
    const debitNotes = await DebitNote.find(filter)
      .sort({ createdAt: -1 })
      .populate('vendorId');
    res.json({ success: true, data: debitNotes });
  } catch (err) {
    console.error('getVendorDebitNotes error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getFinanceVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find({}, '_id companyName').sort({ companyName: 1 }).limit(500);
    res.json({ success: true, data: vendors });
  } catch (err) {
    console.error('getFinanceVendors error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getFinanceDealers = async (req, res) => {
  try {
    // Collect distinct party names from Tally Receipt vouchers + AccountsReceivable
    const [tallyParties, erpParties] = await Promise.all([
      TallyVoucher.distinct('partyName', { voucherType: 'Receipt' }),
      DealerReceipt.find({}, 'dealer').populate('dealer', 'businessName name').then(rs =>
        rs.map(r => r.dealer?.businessName || r.dealer?.name).filter(Boolean)
      ),
    ]);
    const combined = [...new Set([...tallyParties, ...erpParties])].filter(Boolean).sort();
    res.json({ success: true, data: combined.map((name, i) => ({ _id: String(i), name })) });
  } catch (err) {
    console.error('getFinanceDealers error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getTallyLedger = async (req, res) => {
  try {
    const { type, partyName, limit = 100, voucherNumber } = req.query;
    const filter = {};
    if (type) filter.voucherType = type;
    if (partyName) filter.partyName = new RegExp(partyName, 'i');
    if (voucherNumber) filter.voucherNumber = new RegExp(voucherNumber, 'i');
    const vouchers = await TallyVoucher.find(filter)
      .sort({ voucherDate: -1, createdAt: -1 })
      .limit(parseInt(limit));
    res.json({ success: true, data: vouchers });
  } catch (err) {
    console.error('getTallyLedger error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
