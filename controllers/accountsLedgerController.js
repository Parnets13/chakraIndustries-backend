import AccountsLedger from '../models/AccountsLedger.js';

export const getAllAccountsLedgers = async (req, res) => {
  try {
    const { search, ledgerType, syncedWithTally, isActive } = req.query;
    const filter = {};
    
    if (ledgerType) filter.ledgerType = ledgerType;
    if (syncedWithTally !== undefined) filter.syncedWithTally = syncedWithTally === 'true';
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { ledgerName: { $regex: search, $options: 'i' } },
        { ledgerCode: { $regex: search, $options: 'i' } },
        { gstNumber: { $regex: search, $options: 'i' } },
        { tallyLedgerId: { $regex: search, $options: 'i' } }
      ];
    }
    
    const ledgers = await AccountsLedger.find(filter)
      .populate('corporateClientId', 'name status')
      .sort({ createdAt: -1 });
      
    res.json({ success: true, data: ledgers });
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