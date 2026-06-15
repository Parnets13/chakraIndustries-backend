
import AccountsPayable from '../models/AccountsPayable.js';
import AccountsReceivable from '../models/AccountsReceivable.js';
import SupplierPayment from '../models/SupplierPayment.js';
import DealerReceipt from '../models/DealerReceipt.js';
import Vendor from '../models/Vendor.js';
import Invoice from '../models/Invoice.js';

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

    // Format recent transactions for frontend
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
    const { supplierId } = req.query;
    const filter = {};
    if (supplierId) filter.supplier = supplierId;
    const accountsPayable = await AccountsPayable.find(filter)
      .sort({ createdAt: -1 })
      .populate('supplier')
      .populate('purchaseOrder')
      .populate('poInvoice');

    // Format for frontend
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

    res.json({ success: true, data: formattedData });
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
    const { dealerId } = req.query;
    const filter = {};
    if (dealerId) filter.dealer = dealerId;
    const accountsReceivable = await AccountsReceivable.find(filter)
      .sort({ createdAt: -1 })
      .populate('dealer')
      .populate('salesOrder')
      .populate('invoice');

    // Format for frontend
    const formattedData = accountsReceivable.map(ar => ({
      id: ar._id.toString(),
      dealerName: ar.dealer?.businessName || ar.dealer?.name || 'Unknown',
      invoiceNumber: ar.invoiceNumber,
      invoiceAmount: ar.invoiceAmount,
      paidAmount: ar.paidAmount,
      balanceAmount: ar.balanceAmount,
      dueDate: ar.dueDate ? new Date(ar.dueDate).toISOString().split('T')[0] : null,
      paymentStatus: ar.paymentStatus
    }));

    res.json({ success: true, data: formattedData });
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
    const { supplierId } = req.query;
    const filter = {};
    if (supplierId) filter.supplier = supplierId;
    const payments = await SupplierPayment.find(filter)
      .sort({ createdAt: -1 })
      .populate('supplier')
      .populate('accountsPayable');

    // Format for frontend
    const formattedData = payments.map(p => ({
      id: p._id.toString(),
      supplierName: p.supplier?.companyName || 'Unknown',
      invoiceNumber: p.accountsPayable?.invoiceNumber || 'Unknown',
      amount: p.paymentAmount,
      date: p.paymentDate ? new Date(p.paymentDate).toISOString().split('T')[0] : new Date(p.createdAt).toISOString().split('T')[0],
      paymentMethod: p.paymentMethod || 'Other',
      status: 'Completed'
    }));

    res.json({ success: true, data: formattedData });
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
    const { dealerId } = req.query;
    const filter = {};
    if (dealerId) filter.dealer = dealerId;
    const receipts = await DealerReceipt.find(filter)
      .sort({ createdAt: -1 })
      .populate('dealer')
      .populate('accountsReceivable');

    // Format for frontend
    const formattedData = receipts.map(r => ({
      id: r._id.toString(),
      dealerName: r.dealer?.businessName || r.dealer?.name || 'Unknown',
      invoiceNumber: r.accountsReceivable?.invoiceNumber || 'Unknown',
      amount: r.receiptAmount,
      date: r.receiptDate ? new Date(r.receiptDate).toISOString().split('T')[0] : new Date(r.createdAt).toISOString().split('T')[0],
      paymentMethod: r.paymentMethod || 'Other',
      status: 'Completed'
    }));

    res.json({ success: true, data: formattedData });
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
    const [accountsPayable, payments] = await Promise.all([
      AccountsPayable.find(filter).sort({ createdAt: 1 }).populate('supplier'),
      SupplierPayment.find(filter).sort({ createdAt: 1 }).populate('supplier')
    ]);

    // Format for frontend
    const ledger = [];
    let balance = 0;

    // Add invoices (debits)
    accountsPayable.forEach(ap => {
      const date = ap.invoiceDate ? new Date(ap.invoiceDate).toISOString().split('T')[0] : new Date(ap.createdAt).toISOString().split('T')[0];
      balance += ap.invoiceAmount;
      ledger.push({
        id: ap._id.toString(),
        date,
        type: 'Invoice',
        reference: ap.invoiceNumber,
        debit: ap.invoiceAmount,
        credit: 0,
        balance
      });
    });

    // Add payments (credits)
    payments.forEach(p => {
      const date = p.paymentDate ? new Date(p.paymentDate).toISOString().split('T')[0] : new Date(p.createdAt).toISOString().split('T')[0];
      balance -= p.paymentAmount;
      ledger.push({
        id: p._id.toString(),
        date,
        type: 'Payment',
        reference: p._id.toString(),
        debit: 0,
        credit: p.paymentAmount,
        balance
      });
    });

    // Sort by date
    ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

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
    const [accountsReceivable, receipts] = await Promise.all([
      AccountsReceivable.find(filter).sort({ createdAt: 1 }).populate('dealer'),
      DealerReceipt.find(filter).sort({ createdAt: 1 }).populate('dealer')
    ]);

    // Format for frontend
    const ledger = [];
    let balance = 0;

    // Add invoices (credits)
    accountsReceivable.forEach(ar => {
      const date = ar.invoiceDate ? new Date(ar.invoiceDate).toISOString().split('T')[0] : new Date(ar.createdAt).toISOString().split('T')[0];
      balance += ar.invoiceAmount;
      ledger.push({
        id: ar._id.toString(),
        date,
        type: 'Invoice',
        reference: ar.invoiceNumber,
        debit: 0,
        credit: ar.invoiceAmount,
        balance
      });
    });

    // Add receipts (debits)
    receipts.forEach(r => {
      const date = r.receiptDate ? new Date(r.receiptDate).toISOString().split('T')[0] : new Date(r.createdAt).toISOString().split('T')[0];
      balance -= r.receiptAmount;
      ledger.push({
        id: r._id.toString(),
        date,
        type: 'Receipt',
        reference: r._id.toString(),
        debit: r.receiptAmount,
        credit: 0,
        balance
      });
    });

    // Sort by date
    ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

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
    const accounts = [];
    res.json({ success: true, data: accounts });
  } catch (err) {
    console.error('getBankCashAccounts error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getPaymentHistory = async (req, res) => {
  try {
    const [payments, receipts] = await Promise.all([
      SupplierPayment.find().sort({ createdAt: -1 }).populate('supplier'),
      DealerReceipt.find().sort({ createdAt: -1 }).populate('dealer')
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
        status: 'Completed'
      })),
      ...receipts.map(r => ({
        id: r._id.toString(),
        date: r.receiptDate ? new Date(r.receiptDate).toISOString().split('T')[0] : new Date(r.createdAt).toISOString().split('T')[0],
        type: 'Receipt',
        party: r.dealer?.businessName || r.dealer?.name || 'Unknown',
        reference: r._id.toString(),
        amount: r.receiptAmount,
        method: r.paymentMethod || 'Other',
        status: 'Completed'
      }))
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
