/**
 * ledgerBalanceService.js
 * 
 * Service for calculating and managing ledger balances
 * - Calculate closing balance from vouchers
 * - Handle opening/closing balance from Tally
 * - Generate Trial Balance
 */

import AccountsLedger from '../models/AccountsLedger.js';
import TallyVoucher from '../models/TallyVoucher.js';

const LOG = (...a) => console.log('[LedgerBalance]', ...a);
const ERR = (...a) => console.error('[LedgerBalance ERROR]', ...a);

/**
 * Calculate closing balance for a single ledger from vouchers
 * Closing Balance = Opening Balance + Debit Entries - Credit Entries
 */
export async function calculateLedgerClosingBalance(ledgerId, ledgerName) {
  try {
    const ledger = await AccountsLedger.findById(ledgerId);
    if (!ledger) {
      throw new Error(`Ledger not found: ${ledgerId}`);
    }

    // If closing balance was explicitly set from Tally and is recent (less than 24 hours old), trust it
    if (ledger.closingBalanceCalculatedAt && ledger.closingBalance !== undefined) {
      const hoursSinceCalc = (Date.now() - ledger.closingBalanceCalculatedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceCalc < 24 && ledger.closingBalanceCalculatedAt > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) {
        // Recently calculated from Tally, keep it
        return ledger.closingBalance;
      }
    }

    // Calculate from vouchers
    const nameForSearch = ledgerName || ledger.ledgerName;
    
    // Find all vouchers that involve this ledger
    const vouchers = await TallyVoucher.find({
      'ledgerEntries.ledgerName': nameForSearch
    });

    let netAmount = 0;

    // Process vouchers
    for (const voucher of vouchers) {
      for (const entry of voucher.ledgerEntries) {
        if (entry.ledgerName === nameForSearch) {
          // The amount in ledgerEntries should already be signed correctly
          // (positive for debit, negative for credit in accounting terms)
          netAmount += entry.amount || 0;
        }
      }
    }

    // Calculate closing balance
    const closingBalance = ledger.openingBalance + netAmount;
    const closingBalanceType = closingBalance >= 0 ? 'Dr' : 'Cr';

    // Update the ledger with calculated closing balance
    await AccountsLedger.findByIdAndUpdate(
      ledgerId,
      {
        $set: {
          closingBalance: Math.abs(closingBalance),
          closingBalanceType,
          closingBalanceCalculatedAt: new Date()
        }
      },
      { new: true }
    );

    LOG(`Calculated closing balance for ${nameForSearch}: ${closingBalanceType} ${Math.abs(closingBalance)}`);
    return closingBalance;

  } catch (err) {
    ERR(`Error calculating closing balance for ledger ${ledgerId}:`, err.message);
    throw err;
  }
}

/**
 * Recalculate closing balances for all ledgers
 */
export async function recalculateAllLedgerBalances() {
  try {
    const ledgers = await AccountsLedger.find({ isActive: true });
    let updated = 0;
    let failed = 0;

    for (const ledger of ledgers) {
      try {
        await calculateLedgerClosingBalance(ledger._id, ledger.ledgerName);
        updated++;
      } catch (err) {
        ERR(`Failed to recalculate balance for ${ledger.ledgerName}:`, err.message);
        failed++;
      }
    }

    LOG(`Recalculated ${updated} ledgers successfully, ${failed} failed`);
    return { updated, failed, total: ledgers.length };

  } catch (err) {
    ERR('Error recalculating all ledger balances:', err.message);
    throw err;
  }
}

/**
 * Generate Trial Balance
 * Trial Balance = Sum of all Dr balances vs Sum of all Cr balances (should match)
 */
export async function generateTrialBalance() {
  try {
    const ledgers = await AccountsLedger.find({ 
      isActive: true,
      syncedWithTally: true 
    }).sort({ ledgerGroup: 1, ledgerName: 1 });

    const trialBalance = {
      asOfDate: new Date(),
      ledgers: [],
      totalDebit: 0,
      totalCredit: 0,
      isBalanced: false,
      discrepancy: 0
    };

    for (const ledger of ledgers) {
      // Use closing balance if available, otherwise use opening balance
      const balance = ledger.closingBalance !== undefined && ledger.closingBalance !== 0 
        ? ledger.closingBalance 
        : ledger.openingBalance;
      
      const balanceType = ledger.closingBalanceType || ledger.balanceType || 'Dr';

      const entry = {
        ledgerCode: ledger.ledgerCode,
        ledgerName: ledger.ledgerName,
        ledgerGroup: ledger.ledgerGroup,
        balance: balance,
        balanceType: balanceType,
        debit: balanceType === 'Dr' ? balance : 0,
        credit: balanceType === 'Cr' ? balance : 0
      };

      trialBalance.ledgers.push(entry);

      if (balanceType === 'Dr') {
        trialBalance.totalDebit += balance;
      } else {
        trialBalance.totalCredit += balance;
      }
    }

    // Check if balanced
    const discrepancy = Math.abs(trialBalance.totalDebit - trialBalance.totalCredit);
    trialBalance.isBalanced = discrepancy < 0.01; // Allow for floating point errors
    trialBalance.discrepancy = discrepancy;

    LOG(`Trial Balance generated: Dr: ${trialBalance.totalDebit}, Cr: ${trialBalance.totalCredit}, Balanced: ${trialBalance.isBalanced}`);
    return trialBalance;

  } catch (err) {
    ERR('Error generating trial balance:', err.message);
    throw err;
  }
}

/**
 * Get ledger balance summary (opening + closing)
 */
export async function getLedgerBalanceSummary(ledgerId) {
  try {
    const ledger = await AccountsLedger.findById(ledgerId);
    
    if (!ledger) {
      throw new Error(`Ledger not found: ${ledgerId}`);
    }

    return {
      ledgerCode: ledger.ledgerCode,
      ledgerName: ledger.ledgerName,
      ledgerGroup: ledger.ledgerGroup,
      openingBalance: ledger.openingBalance,
      openingBalanceType: ledger.balanceType,
      closingBalance: ledger.closingBalance || ledger.openingBalance,
      closingBalanceType: ledger.closingBalanceType || ledger.balanceType,
      lastCalculated: ledger.closingBalanceCalculatedAt,
      lastSyncedWithTally: ledger.lastTallySync
    };

  } catch (err) {
    ERR('Error getting ledger balance summary:', err.message);
    throw err;
  }
}
