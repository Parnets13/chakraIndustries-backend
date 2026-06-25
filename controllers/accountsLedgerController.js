import AccountsLedger from '../models/AccountsLedger.js';
import TallyVoucher from '../models/TallyVoucher.js';
import { calculateLedgerClosingBalance, recalculateAllLedgerBalances, generateTrialBalance, getLedgerBalanceSummary } from '../services/ledgerBalanceService.js';

export const getAllAccountsLedgers = async (req, res) => {
  try {
    const { search, ledgerType, syncedWithTally, isActive, page, limit } = req.query;
    const filter = {};
    
    if (ledgerType) filter.ledgerType = ledgerType;
    if (syncedWithTally !== undefined) filter.syncedWithTally = syncedWithTally === 'true';
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { ledgerName:    { $regex: search, $options: 'i' } },
        { ledgerCode:    { $regex: search, $options: 'i' } },
        { gstNumber:     { $regex: search, $options: 'i' } },
        { tallyLedgerId: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum  = parseInt(page)  || 0;
    const limitNum = parseInt(limit) || 0;
    const usePagination = pageNum > 0 && limitNum > 0;
    const skip = usePagination ? (pageNum - 1) * limitNum : 0;

    const [ledgers, totalCount] = await Promise.all([
      AccountsLedger.find(filter)
        .populate('corporateClientId', 'name status')
        .sort({ createdAt: -1 })
        .skip(usePagination ? skip : 0)
        .limit(usePagination ? limitNum : 0),
      usePagination ? AccountsLedger.countDocuments(filter) : Promise.resolve(null),
    ]);

    const response = { success: true, data: ledgers };
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
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAccountsLedgerById = async (req, res) => {
  try {
    const ledger = await AccountsLedger.findById(req.params.id)
      .populate('corporateClientId');
      
    if (!ledger) {
      return res.status(404).json({ success: false, message: 'Accounts ledger not found' });
    }
    
    res.json({ success: true, data: ledger });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAccountsLedgerByCorporateId = async (req, res) => {
  try {
    const ledger = await AccountsLedger.findOne({ corporateClientId: req.params.corporateId })
      .populate('corporateClientId');
      
    if (!ledger) {
      return res.status(404).json({ success: false, message: 'Accounts ledger not found' });
    }
    
    res.json({ success: true, data: ledger });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateAccountsLedger = async (req, res) => {
  try {
    const ledger = await AccountsLedger.findByIdAndUpdate(
      req.params.id, 
      req.body, 
      { new: true, runValidators: true }
    );
    
    if (!ledger) {
      return res.status(404).json({ success: false, message: 'Accounts ledger not found' });
    }
    
    res.json({ success: true, data: ledger });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateLedgerBalance = async (req, res) => {
  try {
    const { amount, type = 'Dr' } = req.body;
    const ledger = await AccountsLedger.findById(req.params.id);
    
    if (!ledger) {
      return res.status(404).json({ success: false, message: 'Accounts ledger not found' });
    }
    
    await ledger.updateBalance(amount, type);
    
    res.json({ 
      success: true, 
      data: ledger,
      message: `Balance updated: ${type} ${amount}` 
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getPendingTallySync = async (req, res) => {
  try {
    const ledgers = await AccountsLedger.find({ 
      syncedWithTally: false,
      isActive: true
    })
      .populate('corporateClientId', 'name status')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, data: ledgers, count: ledgers.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const syncLedgerWithTally = async (req, res) => {
  try {
    const ledger = await AccountsLedger.findById(req.params.id);
    
    if (!ledger) {
      return res.status(404).json({ success: false, message: 'Accounts ledger not found' });
    }
    
    // Simulate Tally sync
    ledger.syncedWithTally = true;
    ledger.lastTallySync = new Date();
    await ledger.save();
    
    res.json({ 
      success: true, 
      data: ledger,
      message: 'Ledger synced with Tally successfully' 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getLedgersByType = async (req, res) => {
  try {
    const { type } = req.params;
    const ledgers = await AccountsLedger.find({ 
      ledgerType: type,
      isActive: true
    })
      .populate('corporateClientId', 'name status')
      .sort({ ledgerName: 1 });
    
    res.json({ success: true, data: ledgers, count: ledgers.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Calculate closing balance for a single ledger from vouchers
 */
export const calculateClosingBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const closingBalance = await calculateLedgerClosingBalance(id);
    const ledger = await AccountsLedger.findById(id);
    
    res.json({ 
      success: true, 
      data: ledger,
      message: 'Closing balance calculated successfully',
      closingBalance
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Recalculate closing balances for all ledgers
 */
export const recalculateClosingBalances = async (req, res) => {
  try {
    const result = await recalculateAllLedgerBalances();
    
    res.json({ 
      success: true, 
      data: result,
      message: `Recalculated ${result.updated} ledger balances`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Get trial balance report
 */
export const getTrialBalance = async (req, res) => {
  try {
    const trialBalance = await generateTrialBalance();
    
    res.json({ 
      success: true, 
      data: trialBalance,
      message: trialBalance.isBalanced 
        ? 'Trial Balance is balanced' 
        : `Trial Balance has discrepancy of ${trialBalance.discrepancy}`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Get balance summary for a ledger (opening + closing)
 */
export const getBalanceSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const summary = await getLedgerBalanceSummary(id);
    
    res.json({ 
      success: true, 
      data: summary
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Get ledger transactions (vouchers)
 */
export const getLedgerTransactions = async (req, res) => {
  try {
    const { id } = req.params;
    const ledger = await AccountsLedger.findById(id);
    
    if (!ledger) {
      return res.status(404).json({ success: false, message: 'Ledger not found' });
    }
    
    console.log('Fetching transactions for ledger:', ledger.ledgerName);
    
    // Find vouchers that contain this ledger in their ledgerEntries
    const transactions = await TallyVoucher.find({
      'ledgerEntries.ledgerName': ledger.ledgerName
    })
    .sort({ voucherDate: -1 })
    .limit(500);

    console.log(`Found ${transactions.length} transactions for ledger ${ledger.ledgerName}`);

    res.json({
      success: true,
      data: {
        ledger,
        transactions,
        count: transactions.length
      }
    });
  } catch (err) {
    console.error('Error fetching ledger transactions:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};