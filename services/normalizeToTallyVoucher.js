/**
 * normalizeToTallyVoucher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure function: converts a raw Invoice object into a fully-resolved
 * TallyVoucher sub-document that mirrors Tally's Sales Voucher structure.
 *
 * No DB calls, no network calls — input in, validated sub-document out.
 * Called at write time (bulkUpload, create, update) and by the migration script.
 *
 * Export path then becomes: read stored tallyVoucher → wrap in XML tags → done.
 */

// ─── Unit map ─────────────────────────────────────────────────────────────────
const UNIT_MAP = {
  kg:'Kg', kgs:'Kg', kilogram:'Kg', kilogrames:'Kg',
  liter:'Ltr', litre:'Ltr', ltr:'Ltr', l:'Ltr',
  meter:'Mtr', metre:'Mtr', mtr:'Mtr', m:'Mtr',
  box:'Box', boxes:'Box',
  piece:'Pcs', pieces:'Pcs', pcs:'Pcs', pc:'Pcs',
  nos:'Nos', no:'Nos', number:'Nos', units:'Nos', unit:'Nos',
  pack:'Nos', dozen:'Nos', set:'Nos',
  gm:'Gm', gram:'Gm', grams:'Gm',
  ml:'Ml', milliliter:'Ml',
  ea:'Nos', each:'Nos',
};
const tallyUnit = (u) => UNIT_MAP[(u || '').toLowerCase().trim()] || 'Nos';

// ─── Date helpers ─────────────────────────────────────────────────────────────
/** Format any date value → YYYYMMDD string. Returns null on failure. */
function toTallyDate(d) {
  const dt = d ? new Date(d) : null;
  if (!dt || isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
}

/** Today as YYYYMMDD, always fresh (not stale if server runs overnight). */
function todayTallyDate() {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
}

/**
 * Cap voucherDate to periodEnd.
 * Both are YYYYMMDD strings — lexicographic comparison is correct for this format.
 */
function capDate(voucherDate, periodEnd) {
  if (!periodEnd) return voucherDate;
  return voucherDate > periodEnd ? periodEnd : voucherDate;
}

// ─── GST Ledger Resolver ──────────────────────────────────────────────────────
/**
 * Deterministic: given taxType, salesBase, taxAmount, and optional available
 * ledger names fetched from Tally, returns the correct ledger name to use.
 *
 * Precedence:
 *   1. Rate-specific match from availableLedgerNames (e.g. "Output CGST @ 9%")
 *   2. Plain name from availableLedgerNames (e.g. "CGST")
 *   3. Hardcoded fallback plain name
 *
 * @param {'cgst'|'sgst'|'igst'} taxType
 * @param {number} salesBase
 * @param {number} taxAmount
 * @param {string[]|null} availableLedgerNames
 * @returns {string}
 */
export function resolveGstLedgerName(taxType, salesBase, taxAmount, availableLedgerNames) {
  const plain = { cgst: 'CGST', sgst: 'SGST', igst: 'IGST' }[taxType] || 'CGST';
  const outPrefix = taxType === 'igst' ? 'Output IGST' : `Output ${taxType.toUpperCase()}`;

  if (!availableLedgerNames || !availableLedgerNames.length) return plain;

  // Compute effective rate % (half-rate for CGST/SGST, full rate for IGST)
  let rateStr = '';
  if (salesBase > 0 && taxAmount > 0) {
    const rate = +((taxAmount / salesBase) * 100).toFixed(2);
    // Common rate brackets: 2.5, 5, 6, 9, 12, 14, 18, 28
    const brackets = [2.5, 5, 6, 9, 12, 14, 18, 28];
    // Find closest bracket
    const closest = brackets.reduce((best, b) => Math.abs(b - rate) < Math.abs(best - rate) ? b : best, brackets[0]);
    if (Math.abs(closest - rate) < 0.5) rateStr = String(closest);
  }

  // Try rate-specific name first (e.g. "Output CGST @ 9%")
  if (rateStr) {
    const rateSpecific = `${outPrefix} @ ${rateStr}%`;
    if (availableLedgerNames.some(n => n.trim().toLowerCase() === rateSpecific.toLowerCase())) {
      return rateSpecific;
    }
  }

  // Try plain "Output CGST" style (without rate)
  const plainOut = availableLedgerNames.find(n => n.trim().toLowerCase() === outPrefix.toLowerCase());
  if (plainOut) return plainOut;

  // Try bare "CGST"/"SGST"/"IGST"
  const bareMatch = availableLedgerNames.find(n => n.trim().toLowerCase() === plain.toLowerCase());
  if (bareMatch) return bareMatch;

  // Fallback
  return plain;
}

// ─── Main normalizer ──────────────────────────────────────────────────────────
/**
 * Convert a raw Invoice object into a validated TallyVoucher sub-document.
 *
 * @param {Object} invoiceData  - Raw invoice fields (same shape as Invoice mongoose doc)
 * @param {Object} options
 * @param {Object|null} options.tallyGstLedgers  - GST ledger names fetched from Tally: { cgstNames, sgstNames, igstNames } (can be null)
 * @param {string|null} options.periodEnd       - YYYYMMDD period end cap (can be null)
 * @param {string|null} options.companyName     - Tally company name (informational only)
 * @param {string}      options.salesVoucherTypeName - Sales voucher type name in Tally (default: 'Sales')
 * @returns {Object} TallyVoucher sub-document (NOT a Mongoose model instance)
 * @throws {Error} if required fields missing or voucher is imbalanced
 */
export function normalizeToTallyVoucher(invoiceData, options = {}) {
  const { tallyGstLedgers = null, periodEnd = null, salesVoucherTypeName = 'Sales' } = options;

  // ── Required field validation ────────────────────────────────────────────
  const invoiceNo = (invoiceData.invoiceNo || '').toString().trim();
  if (!invoiceNo) throw new Error('normalizeToTallyVoucher: invoiceNo is required');

  const partyLedgerName = (invoiceData.partyName || '').toString().trim();
  if (!partyLedgerName) throw new Error('normalizeToTallyVoucher: partyName is required');

  // ── Date ─────────────────────────────────────────────────────────────────
  const rawDate  = toTallyDate(invoiceData.invoiceDate) || todayTallyDate();
  const voucherDate = capDate(rawDate, periodEnd);

  // ── Amounts ──────────────────────────────────────────────────────────────
  // When items have authoritative per-item totals (from Excel 'Total Value' column),
  // use their sum as the grandTotal. This avoids recomputing from rate×qty and losing
  // the exact values from the source document.
  const itemsWithTotal = (invoiceData.items || []).filter(i => +(i.total || 0) > 0);
  const grandTotal = itemsWithTotal.length > 0
    ? +itemsWithTotal.reduce((s, i) => s + +(i.total || 0), 0).toFixed(2)
    : +((invoiceData.grandTotal || invoiceData.totalAmount || 0)).toFixed(2);
  const storedGrandTotal = +((invoiceData.grandTotal || invoiceData.totalAmount || 0)).toFixed(2);
  // Use whichever is nonzero; prefer the items-based sum when available
  const resolvedGrandTotal = grandTotal > 0 ? grandTotal : storedGrandTotal;
  if (resolvedGrandTotal <= 0) throw new Error(`normalizeToTallyVoucher: grandTotal must be > 0 (got ${resolvedGrandTotal})`);

  const items = invoiceData.items || [];

  // ── GST slab snapping ─────────────────────────────────────────────────────
  const GST_SLABS = [0, 2.5, 5, 6, 9, 12, 14, 18, 28];
  const snapToSlab = (rate) => {
    if (rate <= 0) return 0;
    return GST_SLABS.reduce((best, s) => Math.abs(s - rate) < Math.abs(best - rate) ? s : best, GST_SLABS[0]);
  };

  // ── Determine GST rate from items ─────────────────────────────────────────
  // Use item.taxRate (full GST%) if stored, else back-calculate from raw amounts.
  // Snap to standard slab to match Tally's internal calculation.
  const rawIGST = invoiceData.igstTotal ?? items.reduce((s, i) => s + (+(i.igst || 0)), 0);
  const isInterstate = rawIGST > 0;

  // Find the GST rate: prefer item.taxRate, then back-calculate from raw amounts
  const firstItem = items[0] || {};
  let gstRateFull = snapToSlab(+(firstItem.taxRate || 0));
  if (!gstRateFull) {
    // Back-calculate from raw tax / grandTotal
    const rawCGSTsum = invoiceData.cgstTotal ?? items.reduce((s, i) => s + (+(i.cgst || 0)), 0);
    const rawSGSTsum = invoiceData.sgstTotal ?? items.reduce((s, i) => s + (+(i.sgst || 0)), 0);
    const rawIGSTsum = rawIGST;
    const rawTax = rawCGSTsum + rawSGSTsum + rawIGSTsum;
    if (rawTax > 0 && resolvedGrandTotal > 0) {
      // tax / (grandTotal - tax) × 100 = rate%
      gstRateFull = snapToSlab(+((rawTax / (resolvedGrandTotal - rawTax)) * 100).toFixed(4));
    }
  }

  // ── Compute tax amounts CORRECTLY from grandTotal + rate ──────────────────
  // Formula: taxableBase = grandTotal / (1 + rate/100), tax = grandTotal - taxableBase
  // This is the EXACT same formula Tally uses internally.
  // Never use raw unrounded per-item cgst/sgst values — they cause ±0.01 mismatch.
  let totalCGST, totalSGST, totalIGST, salesBase;
  if (gstRateFull > 0) {
    const taxableBase = +(resolvedGrandTotal / (1 + gstRateFull / 100)).toFixed(2);
    const totalTaxAmt = +(resolvedGrandTotal - taxableBase).toFixed(2);
    salesBase = taxableBase;
    if (isInterstate) {
      totalCGST = 0;
      totalSGST = 0;
      totalIGST = totalTaxAmt;
    } else {
      // Split evenly: one half rounded up, other is the remainder
      const half = +(totalTaxAmt / 2).toFixed(2);
      totalCGST = half;
      totalSGST = +(totalTaxAmt - half).toFixed(2);
      totalIGST = 0;
    }
  } else {
    // No GST — zero tax
    totalCGST = 0;
    totalSGST = 0;
    totalIGST = 0;
    salesBase = resolvedGrandTotal;
  }
  const totalTax = +(totalCGST + totalSGST + totalIGST).toFixed(2);

  // ── GST ledger names ──────────────────────────────────────────────────────
  const cgstLedger = totalCGST > 0 ? resolveGstLedgerName('cgst', salesBase, totalCGST, tallyGstLedgers?.cgstNames) : '';
  const sgstLedger = totalSGST > 0 ? resolveGstLedgerName('sgst', salesBase, totalSGST, tallyGstLedgers?.sgstNames) : '';
  const igstLedger = totalIGST > 0 ? resolveGstLedgerName('igst', salesBase, totalIGST, tallyGstLedgers?.igstNames) : '';

  // ── Inventory entries (only when item amounts balance against salesBase) ──
  // IMPORTANT: Inventory entries require a valid GSTLEDGERSOURCE ledger name.
  // "Sales Accounts" is Tally's built-in GROUP name (parent of all sales ledgers),
  // NOT a ledger — referencing it as GSTLEDGERSOURCE causes Tally to silently
  // reject the voucher with CREATED=0 and no error message.
  // Only include inventory entries when we have a real, specific ledger name
  // stored in item.tallySalesLedger (e.g. "SS Bottle Sales Local 5%").
  // Otherwise fall back to pure-accounting format (ledger entries only).
  const validItems = items.filter(item => (item.description || item.name || '').toString().trim());
  const itemAmounts = validItems.map(item => {
    const qty  = +(item.qty || 1);
    const rate = +(item.rate || 0);
    // Priority: item.basic (direct from Excel, unrounded taxable value)
    // → item.amount (may be rounded by computeTotals — avoid if basic available)
    // → qty × rate (fallback computation)
    // Using item.basic avoids the 219.0476→219.05 rounding that causes Tally's
    // e-invoice engine to flag "Tax amount does not match".
    return +(item.basic > 0 ? item.basic : (item.amount || (qty * rate))).toFixed(2);
  });
  // Fix rounding: force the last item amount to absorb any 1-paisa discrepancy
  // so sum of items always exactly equals salesBase. This prevents Tally EXCEPTIONS
  // caused by a ±0.01 mismatch between inventory entries and ledger entries.
  // IMPORTANT: This adjustment MUST happen BEFORE per-item tax rates are computed
  // so that itemSalesBase and rateDetails are derived from the final adjusted amount,
  // not the pre-adjustment amount. Computing rates before this adjustment causes
  // Tally's e-invoice engine to recalculate adjustedBase × rate% ≠ sent tax amount.
  const rawItemsTotal = +itemAmounts.reduce((s, a) => s + a, 0).toFixed(2);
  if (itemAmounts.length > 0 && Math.abs(rawItemsTotal - salesBase) <= 0.10 && rawItemsTotal !== salesBase) {
    const diff = +(salesBase - rawItemsTotal).toFixed(2);
    itemAmounts[itemAmounts.length - 1] = +(itemAmounts[itemAmounts.length - 1] + diff).toFixed(2);
  }
  const itemsTotal = +itemAmounts.reduce((s, a) => s + a, 0).toFixed(2);

  // ── Invoice-level GST rate fallbacks ─────────────────────────────────────
  const invoiceCgstRate = totalCGST > 0 && salesBase > 0 ? snapToSlab(+((totalCGST / salesBase) * 100).toFixed(4)) : 0;
  const invoiceSgstRate = totalSGST > 0 && salesBase > 0 ? snapToSlab(+((totalSGST / salesBase) * 100).toFixed(4)) : 0;
  const invoiceIgstRate = totalIGST > 0 && salesBase > 0 ? snapToSlab(+((totalIGST / salesBase) * 100).toFixed(4)) : 0;

  // useInventory: send items as ALLINVENTORYENTRIES.LIST to show item columns in Tally
  const useInventory = true;

  // First, calculate the sales ledger name (needed for tax source ledger)
  const INVALID_SALES_NAMES = new Set(['sales accounts', 'sales accounts (group)', '']);
  const itemLedgers = validItems
    .map(item => {
      const raw = (item.tallySalesLedger || '').toString().trim();
      return INVALID_SALES_NAMES.has(raw.toLowerCase()) ? '' : raw;
    })
    .filter(Boolean);
  // Unique ledger names used across all items
  const uniqueItemLedgers = [...new Set(itemLedgers)];
  // Use the single shared ledger if all items agree, else use first one, else fallback
  const salesCreditLedger = uniqueItemLedgers.length === 1
    ? uniqueItemLedgers[0]
    : uniqueItemLedgers.length > 1
      ? uniqueItemLedgers[0]
      : 'Sales';   // ← auto-created ledger under "Sales Accounts" group

  const allInventoryEntries = useInventory ? validItems.map((item, i) => {
    const itemName   = (item.description || item.name || '').toString().trim();
    const itemQty    = +(item.qty || 1);
    const itemRate   = +(item.rate || 0);
    const itemAmount = itemAmounts[i];
    const itemUnit   = tallyUnit(item.unit || 'Nos');
    const itemHSN    = (item.hsn || '').toString().trim();
    const itemCGST   = +(item.cgst || 0);
    const itemSGST   = +(item.sgst || 0);
    const itemIGST   = +(item.igst || 0);
    // itemSalesBase = itemAmount (the taxable/basic value sent as the inventory entry amount).
    // CGST/SGST/IGST are SEPARATE ledger entries — they are NOT included in itemAmount.
    // Do NOT subtract them from itemAmount: doing so produces an incorrect base for the
    // rate calculation (e.g. 219.05 - 5.48 - 5.48 = 208.09 instead of 219.05), which
    // causes Tally's e-invoice engine to compute a different tax amount and show the
    // "Tax amount does not match" warning.
    const itemSalesBase = itemAmount;
    
    // Calculate tax rates from the adjusted item amounts.
    // When per-item cgst/sgst are zero (invoice-level-only tax data from Excel upload),
    // fall back to the invoice-level effective rate so rateDetails is never sent as 0%
    // while LEDGERENTRIES carries a nonzero tax amount (which triggers the e-invoice
    // "Tax amount does not match" warning).
    // Snap rates to standard GST slabs to avoid Tally's e-invoice engine mismatch.
    const calculateRate = (taxAmount, base) => {
      if (base <= 0 || taxAmount <= 0) return 0;
      return snapToSlab(+((taxAmount / base) * 100).toFixed(4));
    };
    // item.taxRate is the full GST % stored on the item (e.g. 18 for 18% GST).
    // CGST/SGST are each half of it. Prefer stored taxRate for accuracy over back-calculation.
    const itemTaxRate = +(item.taxRate || 0);
    const isInterstateTx = itemIGST > 0 || (itemCGST === 0 && itemSGST === 0 && itemIGST === 0 && invoiceIgstRate > 0);
    // Use stored taxRate when per-item amounts are zero (Excel-upload scenario):
    // taxRate=18 → CGST=9%, SGST=9%
    const storedHalfRate = itemTaxRate > 0 ? snapToSlab(itemTaxRate / 2) : 0;
    const storedIgstRate = itemTaxRate > 0 ? snapToSlab(itemTaxRate) : 0;
    const cgstRate = itemCGST > 0 ? calculateRate(itemCGST, itemSalesBase)
                   : storedHalfRate > 0 && !isInterstateTx ? storedHalfRate
                   : invoiceCgstRate;
    const sgstRate = itemSGST > 0 ? calculateRate(itemSGST, itemSalesBase)
                   : storedHalfRate > 0 && !isInterstateTx ? storedHalfRate
                   : invoiceSgstRate;
    const igstRate = itemIGST > 0 ? calculateRate(itemIGST, itemSalesBase)
                   : storedIgstRate > 0 && isInterstateTx ? storedIgstRate
                   : invoiceIgstRate;
    
    // Sales ledger: use item.tallySalesLedger if set and valid, else 'Sales'
    const INVALID_LEDGER_NAMES = new Set(['sales accounts', 'sales accounts (group)', '']);
    const TALLY_VOUCHER_TYPES = ['sales', 'purchase', 'receipt', 'payment', 'journal', 'contra', 'debit note', 'credit note', 'stock journal', 'vouchers'];
    const rawLedger = (item.tallySalesLedger || '').toString().trim();
    const rawLedgerLower = rawLedger.toLowerCase();
    const itemNameLower = itemName.toLowerCase();
    const isInvalidLedger = INVALID_LEDGER_NAMES.has(rawLedgerLower)
      || TALLY_VOUCHER_TYPES.includes(rawLedgerLower)
      || rawLedgerLower === itemNameLower;
    const salesLedger = (rawLedger && !isInvalidLedger) ? rawLedger : 'Sales';
    
    // Only emit GSTLEDGERSOURCE when salesLedger is a real item-specific ledger
    // that has GST rates configured in its Tally master.
    // 'Sales' is a plain generic fallback ledger with NO GST rate in its master —
    // emitting GSTLEDGERSOURCE='Sales' causes Tally to read rate=0% from that ledger
    // while RATEDETAILS says 9%, triggering "Tax amount does not match" on e-invoice print.
    // Only emit GSTLEDGERSOURCE when the ledger is item-specific (e.g. "SS Bottle Sales Local 5%").
    const GENERIC_LEDGER_NAMES = new Set(['sales', 'sales accounts', 'sales accounts (group)', '']);
    const hasSpecificLedger = !GENERIC_LEDGER_NAMES.has(salesLedger.toLowerCase());
    const isInterstateItem = itemIGST > 0;

    return {
      stockItemName:  itemName,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      isGstAssessableValueOverridden: false,
      strDisGstApplicable: false,
      contentNegIsPos: false,
      isAutoNegate: false,
      isCustomsClearance: false,
      isTrackComponent: false,
      isTrackProduction: false,
      isPrimaryItem: false,
      isScrap: false,
      rate:    `${itemRate.toFixed(2)}/${itemUnit}`,
      amount:  itemAmount,
      actualQty: `${itemQty} ${itemUnit}`,
      billedQty:  `${itemQty} ${itemUnit}`,
      // GST source fields: only include when we have a specific (non-group) ledger
      gstSourceType:         hasSpecificLedger ? 'Ledger' : '',
      gstLedgerSource:       hasSpecificLedger ? salesLedger : '',
      hsnSourceType:         hasSpecificLedger ? 'Ledger' : '',
      hsnLedgerSource:       hasSpecificLedger ? salesLedger : '',
      gstOverrideTaxability: 'Taxable',
      gstOverrideSupplyType: 'Goods',
      gstOverrideStoredNature: isInterstateItem ? 'Interstate Sales - Taxable' : 'Intrastate Sales - Taxable',
      gstHsnName:            itemHSN,
      gstHsnInferApplicability: 'As per Masters/Company',
      gstOvrdnIsRevchargeApplic: 'Not Applicable',
      // Batch allocations (real godown "Srichakra Industries")
      batchAllocations: [{
        godownName: 'Srichakra Industries',
        batchName: 'Primary Batch',
        indentNo: 'Not Applicable',
        orderNo: 'Not Applicable',
        trackingNumber: 'Not Applicable',
        dynamicCstIsCleared: false,
        amount: itemAmount,
        actualQty: `${itemQty} ${itemUnit}`,
        billedQty: `${itemQty} ${itemUnit}`,
      }],
      // Rate details (CGST, SGST/UTGST, or IGST)
      // CRITICAL: When GSTLEDGERSOURCE is set to a specific item sales ledger
      // (e.g. "SS Bottle Sales Local 5%"), Tally derives the GST rates from that
      // ledger's master configuration. Sending RATEDETAILS alongside causes a conflict:
      // Tally checks ledger-master-rate vs RATEDETAILS and shows "Tax amount does not
      // match" because it sees two different rate sources. Solution: only send
      // RATEDETAILS when there is NO specific ledger source (i.e. generic 'Sales' fallback).
      // When hasSpecificLedger=true, omit RATEDETAILS entirely — Tally will use the ledger.
    rateDetails: hasSpecificLedger ? [] : [
      ...(cgstRate > 0 ? [{ gstRateDutyHead: 'CGST', gstRateEvaluationType: 'Based on Value', gstRate: cgstRate }] : []),
      ...(sgstRate > 0 ? [{ gstRateDutyHead: 'SGST/UTGST', gstRateEvaluationType: 'Based on Value', gstRate: sgstRate }] : []),
      ...(igstRate > 0 ? [{ gstRateDutyHead: 'IGST', gstRateEvaluationType: 'Based on Value', gstRate: igstRate }] : []),
    ],
      // Accounting allocations
      accountingAllocations: [{
        ledgerName: salesLedger,
        isDeemedPositive: false,
        isLastDeemedPositive: false,
        ledgerFromItem: false,
        removeZeroEntries: false,
        isPartyLedger: false,
        gstClass: 'Not Applicable',
        amount: itemAmount,
      }],
    };
  }) : [];

  // ── Tax totals for LEDGERENTRIES — already correctly computed above ───────
  // totalCGST / totalSGST / totalIGST are derived from grandTotal+rate formula.
  // They exactly match what Tally will recalculate. No further recon needed.
  const ledgerCGST     = totalCGST;
  const ledgerSGST     = totalSGST;
  const ledgerIGST     = totalIGST;
  const reconTotalTax  = totalTax;
  const reconSalesBase = salesBase;
  const reconGrandTotal = resolvedGrandTotal;

  // Adjust last inventory entry amount to sum exactly to salesBase.
  if (allInventoryEntries.length > 0) {
    const currentItemsSum = +allInventoryEntries.reduce((s, e) => s + (e.amount || 0), 0).toFixed(2);
    if (currentItemsSum !== reconSalesBase && Math.abs(currentItemsSum - reconSalesBase) <= 0.10) {
      const diff = +(reconSalesBase - currentItemsSum).toFixed(2);
      const last = allInventoryEntries[allInventoryEntries.length - 1];
      last.amount = +(last.amount + diff).toFixed(2);
      if (last.accountingAllocations?.[0]) last.accountingAllocations[0].amount = last.amount;
      if (last.batchAllocations?.[0])      last.batchAllocations[0].amount      = last.amount;
    }
  }

  // ── Ledger entries ────────────────────────────────────────────────────────
  const allLedgerEntries = [];

  // 1. Party ledger (debit) — use reconGrandTotal so party matches inventory+tax
  allLedgerEntries.push({
    ledgerName: partyLedgerName,
    isDeemedPositive: true,
    isLastDeemedPositive: true,
    amount: -reconGrandTotal,    // negative in Tally XML = debit from voucher's perspective
    billAllocations: [{
      name:     invoiceNo,
      billType: 'New Ref',
      amount:   -reconGrandTotal,
    }],
  });

  // 2. CGST — use reconCGST (matches exactly what Tally will recalculate from rateDetails)
  if (ledgerCGST > 0 && cgstLedger) {
    allLedgerEntries.push({
      ledgerName: cgstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +ledgerCGST
    });
  }

  // 3. SGST
  if (ledgerSGST > 0 && sgstLedger) {
    allLedgerEntries.push({
      ledgerName: sgstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +ledgerSGST
    });
  }

  // 4. IGST
  if (ledgerIGST > 0 && igstLedger) {
    allLedgerEntries.push({
      ledgerName: igstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +ledgerIGST
    });
  }

  // Only add sales credit ledger entry if we're not using inventory entries
    // (inventory entries' ACCOUNTINGALLOCATIONS.LIST will handle the sales credit)
    if (!useInventory) {
      allLedgerEntries.push({
        ledgerName: salesCreditLedger,
        isDeemedPositive: false,
        isLastDeemedPositive: false,
        amount: totalTax > 0 ? +salesBase : +resolvedGrandTotal,
        billAllocations: [],
      });
    }

  // ── Balance check ─────────────────────────────────────────────────────────
  const ledgerSum = +allLedgerEntries.reduce((s, e) => s + e.amount, 0).toFixed(2);
  const inventorySum = useInventory 
    ? +allInventoryEntries.reduce((s, e) => s + (e.amount || 0), 0).toFixed(2)
    : 0;
  const totalSum = (+ledgerSum + +inventorySum).toFixed(2);

  if (Math.abs(+totalSum) > 0.01) {
    throw new Error(
      `normalizeToTallyVoucher: voucher imbalanced by ${totalSum} ` +
      `(invoice ${invoiceNo}, grandTotal=${reconGrandTotal}, cgst=${ledgerCGST}, sgst=${ledgerSGST}, igst=${ledgerIGST}, salesBase=${reconSalesBase})`
    );
  }

  // ── Narration — only include invoice metadata (no item details when inventory is used) ──
  const origDateFmt = invoiceData.invoiceDate
    ? new Date(invoiceData.invoiceDate).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })
    : '';
  const poRef = (invoiceData.buyersOrderNo || invoiceData.purchaseOrderRef || '').toString().trim();
  
  // Only add item lines to narration when NOT using inventory entries
  const itemLines = useInventory ? [] : validItems.map((item, i) => {
    const itemName   = (item.description || item.name || '').toString().trim();
    const itemQty    = +(item.qty || 1);
    const itemRate   = +(item.rate || 0);
    const itemAmount = itemAmounts[i];
    const itemUnit   = tallyUnit(item.unit || 'Nos');
    // Format: "1. HYDRA STEEL WATER BOTTLE 1000ML: 50 Nos @ ₹150.00 = ₹7,500.00"
    return `${i + 1}. ${itemName}: ${itemQty} ${itemUnit} @ ₹${itemRate.toFixed(2)} = ₹${itemAmount.toFixed(2)}`;
  });
  
  // Send empty narration to ensure e-invoice prints correctly
  const narration = '';

  // ── Assemble sub-document ─────────────────────────────────────────────────
  // ── PO Date → YYYYMMDD ────────────────────────────────────────────────────
  const rawPoDate = invoiceData.poDate || '';
  const poDateTally = rawPoDate ? (toTallyDate(rawPoDate) || '') : '';

  // ── Ship To fields ────────────────────────────────────────────────────────
  const shipToName     = (invoiceData.shipToName    || invoiceData.shipToMailingName || '').toString().trim();
  const shipToAddress  = (invoiceData.shipToAddress || '').toString().trim();
  let   shipToCity     = (invoiceData.shipToCity    || '').toString().trim();
  let   shipToState    = (invoiceData.shipToState   || '').toString().trim();
  const shipToGST      = (invoiceData.shipToGST     || '').toString().trim();
  // Ship-to data must not inherit the bill-to postal code.  Doing so creates a
  // misleading partial consignee block (a name from ship-to plus a pin from the
  // customer) which Tally can silently reject during GST validation.
  let   shipToPincode  = (invoiceData.shipToPincode || '').toString().trim();

  // ── Extract pincode/state from shipToAddress when separate fields are empty ─
  // Raw data from Tally sync often arrives as one concatenated string like:
  // "BASHA FOOTWEARSADUMNEAR POLICE STATION, SADUMAP517123"
  // where state code + pincode are concatenated with no space.
  if (shipToAddress && !shipToPincode) {
    const pinMatch = shipToAddress.match(/[A-Za-z]?(\d{6})(?:\D|$)/);
    if (pinMatch) shipToPincode = pinMatch[1];
  }
  // Derive state from pincode ranges (reliable, no regex ambiguity)
  if (shipToPincode && !shipToState) {
    const pin = parseInt(shipToPincode, 10);
    if      (pin >= 110001 && pin <= 110099) shipToState = 'Delhi';
    else if (pin >= 120001 && pin <= 135999) shipToState = 'Haryana';
    else if (pin >= 140001 && pin <= 160099) shipToState = 'Punjab';
    else if (pin >= 171001 && pin <= 177999) shipToState = 'Himachal Pradesh';
    else if (pin >= 180001 && pin <= 194599) shipToState = 'Jammu and Kashmir';
    else if (pin >= 201001 && pin <= 285999) shipToState = 'Uttar Pradesh';
    else if (pin >= 301001 && pin <= 345999) shipToState = 'Rajasthan';
    else if (pin >= 360001 && pin <= 396999) shipToState = 'Gujarat';
    else if (pin >= 400001 && pin <= 445999) shipToState = 'Maharashtra';
    else if (pin >= 450001 && pin <= 480999) shipToState = 'Madhya Pradesh';
    else if (pin >= 481001 && pin <= 497999) shipToState = 'Chhattisgarh';
    else if (pin >= 500001 && pin <= 509999) shipToState = 'Telangana';
    else if (pin >= 515001 && pin <= 535999) shipToState = 'Andhra Pradesh';
    else if (pin >= 560001 && pin <= 591999) shipToState = 'Karnataka';
    else if (pin >= 600001 && pin <= 643999) shipToState = 'Tamil Nadu';
    else if (pin >= 682001 && pin <= 695999) shipToState = 'Kerala';
    else if (pin >= 700001 && pin <= 743999) shipToState = 'West Bengal';
    else if (pin >= 751001 && pin <= 770099) shipToState = 'Odisha';
    else if (pin >= 800001 && pin <= 813999) shipToState = 'Bihar';
    else if (pin >= 814001 && pin <= 835999) shipToState = 'Jharkhand';
    else if (pin >= 900001 && pin <= 999999) shipToState = 'Assam';
  }

  // ── Bill To fields ────────────────────────────────────────────────────────
  const billToName        = (invoiceData.billToName    || invoiceData.billToMailingName || partyLedgerName).toString().trim();
  const billToMailingName = (invoiceData.billToMailingName || invoiceData.billToName || partyLedgerName).toString().trim();
  const billToAddress     = (invoiceData.billToAddress || invoiceData.partyAddress || '').toString().trim();
  const billToCity        = (invoiceData.billToCity    || invoiceData.partyCity    || '').toString().trim();
  const billToState       = (invoiceData.billToState   || invoiceData.partyState   || '').toString().trim();
  const billToGST         = (invoiceData.billToGST     || invoiceData.partyGST     || '').toString().trim();
  const billToPincode     = (invoiceData.billToPincode || invoiceData.partyPostal || '').toString().trim();

  // ── Party GST / State (Step 6 fields) ────────────────────────────────────
  const partyGST      = (invoiceData.partyGST   || '').toString().trim();
  const partyState    = (invoiceData.partyState  || billToState || '').toString().trim();

  // ── Company address ───────────────────────────────────────────────────────
  const companyAddress = (invoiceData.companyAddress || '').toString().trim();

  // ── Godown name — resolved from invoice warehouse field or left blank ─────
  // The serializer in tallyExportService will resolve the final godown name
  // (falling back to warehouseNames[] then "Main Location").
  const godownName = (invoiceData.godownName || invoiceData.warehouse || '').toString().trim();

  // ── E-Invoice fields (IRN, AckNo, AckDate) ───────────────────────────────
  // These are set when the ERP generates an e-invoice via the GST portal.
  // Must be forwarded to Tally so the e-invoice details print on the invoice.
  // IRN must be a valid 64-char hex string; discard anything else (Tally GUIDs etc.)
  const rawIrn = (invoiceData.irn || '').toString().trim();
  const irn = /^[0-9a-fA-F]{64}$/.test(rawIrn) ? rawIrn : '';
  const ackNo = (invoiceData.ackNo || invoiceData.ackno || '').toString().trim();
  // ackDate: store as YYYYMMDD string for Tally XML
  let ackDate = '';
  if (invoiceData.ackDate) {
    const d = new Date(invoiceData.ackDate);
    if (!isNaN(d.getTime())) {
      ackDate = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    }
  }

  return {
    voucherType:      salesVoucherTypeName,   // exact name from Tally's VoucherType list
    voucherNumber:    invoiceNo,
    date:             voucherDate,
    effectiveDate:    voucherDate,
    partyLedgerName,
    isinvoice:        true,
    buyersOrderNo:    (invoiceData.buyersOrderNo || invoiceData.purchaseOrderRef || '').toString().trim(),
    poDate:           poDateTally,
    narration,
    // E-Invoice fields — forwarded to Tally XML so e-invoice prints correctly
    irn,
    ackNo,
    ackDate,
    // Ship To — written as flat top-level tags on the <VOUCHER> element
    shipToName,
    shipToAddress,
    shipToCity,
    shipToState,
    shipToGST,
    shipToPincode,
    // Bill To — written to BASICBUYERADDRESS.LIST (top-level, TYPE="String")
    billToName,
    billToMailingName,
    billToAddress,
    billToCity,
    billToState,
    billToGST,
    billToPincode,
    // Party identification (Step 6)
    partyGST,
    partyState,
    // Company / dispatch address
    companyAddress,
    // Godown — resolved by serializer; blank means serializer picks first warehouse or "Main Location"
    godownName,
    allLedgerEntries,
    allInventoryEntries,
    // Snapshot amounts — stored so export doesn't recompute
    _grandTotal:  reconGrandTotal,
    _totalCGST:   ledgerCGST,
    _totalSGST:   ledgerSGST,
    _totalIGST:   ledgerIGST,
    _salesBase:   reconSalesBase,
    _useInventory: useInventory,
  };
}
