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
  const grandTotal = +((invoiceData.grandTotal || invoiceData.totalAmount || 0)).toFixed(2);
  if (grandTotal <= 0) throw new Error(`normalizeToTallyVoucher: grandTotal must be > 0 (got ${grandTotal})`);

  const items = invoiceData.items || [];
  const totalCGST = +((invoiceData.cgstTotal ?? items.reduce((s, i) => s + (i.cgst || 0), 0))).toFixed(2);
  const totalSGST = +((invoiceData.sgstTotal ?? items.reduce((s, i) => s + (i.sgst || 0), 0))).toFixed(2);
  const totalIGST = +((invoiceData.igstTotal ?? items.reduce((s, i) => s + (i.igst || 0), 0))).toFixed(2);
  const totalTax  = +(totalCGST + totalSGST + totalIGST).toFixed(2);
  const salesBase = +(grandTotal - totalTax).toFixed(2);

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
    return +(item.amount || item.basic || (qty * rate)).toFixed(2);
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
  // When invoice data stores CGST/SGST only at invoice level (not per-item) —
  // common from Excel bulk upload — item.cgst is 0 for every line item.
  // Back-calculating cgstRate = 0 / itemAmount = 0 sends 0% to rateDetails
  // while LEDGERENTRIES carries a nonzero CGST amount → e-invoice mismatch.
  // Fallback: derive the effective rate from invoice-level totals so rateDetails
  // always reflects a nonzero rate when CGST/SGST is present on the voucher.
  const invoiceCgstRate = salesBase > 0 && totalCGST > 0
    ? +((totalCGST / salesBase) * 100).toFixed(2) : 0;
  const invoiceSgstRate = salesBase > 0 && totalSGST > 0
    ? +((totalSGST / salesBase) * 100).toFixed(2) : 0;
  const invoiceIgstRate = salesBase > 0 && totalIGST > 0
    ? +((totalIGST / salesBase) * 100).toFixed(2) : 0;

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

  const isInterstate = totalIGST > 0;

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
    // itemSalesBase derived from the ALREADY-ADJUSTED itemAmount (rounding done above).
    const itemSalesBase = +(itemAmount - itemCGST - itemSGST - itemIGST).toFixed(2);
    
    // Calculate tax rates from the adjusted item amounts.
    // When per-item cgst/sgst are zero (invoice-level-only tax data from Excel upload),
    // fall back to the invoice-level effective rate so rateDetails is never sent as 0%
    // while LEDGERENTRIES carries a nonzero tax amount (which triggers the e-invoice
    // "Tax amount does not match" warning).
    const calculateRate = (taxAmount, base) => {
      if (base <= 0 || taxAmount <= 0) return 0;
      return +((taxAmount / base) * 100).toFixed(2);
    };
    const cgstRate = itemCGST > 0 ? calculateRate(itemCGST, itemSalesBase) : invoiceCgstRate;
    const sgstRate = itemSGST > 0 ? calculateRate(itemSGST, itemSalesBase) : invoiceSgstRate;
    const igstRate = itemIGST > 0 ? calculateRate(itemIGST, itemSalesBase) : invoiceIgstRate;
    
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
    
    // Only emit GSTLEDGERSOURCE when salesLedger is NOT 'Sales Accounts'
    const hasSpecificLedger = salesLedger.toLowerCase() !== 'sales accounts' && salesLedger.toLowerCase() !== '';
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
      gstRateInferApplicability: 'Not Applicable',
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
      // No rate details - let Tally use our ledger tax amounts without auto-calculating
    rateDetails: [],
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

  // ── Ledger entries ────────────────────────────────────────────────────────
  const allLedgerEntries = [];

  // 1. Party ledger (debit)
  allLedgerEntries.push({
    ledgerName: partyLedgerName,
    isDeemedPositive: true,
    isLastDeemedPositive: true,
    amount: -grandTotal,    // negative in Tally XML = debit from voucher's perspective
    billAllocations: [{
      name:     invoiceNo,
      billType: 'New Ref',
      amount:   -grandTotal,
    }],
  });

  // 2. CGST
  // Tally sign convention: ISDEEMEDPOSITIVE=No (credit) → AMOUNT is POSITIVE.
  // ISDEEMEDPOSITIVE=Yes (debit) → AMOUNT is NEGATIVE.
  // Party (debtor) is isDeemedPositive=true → amount=-grandTotal (negative).
  // Tax and Sales ledgers are isDeemedPositive=false → amount POSITIVE.
  const calculateRate = (taxAmount, base) => {
    if (base <= 0 || taxAmount <= 0) return 0;
    return +((taxAmount / base) * 100).toFixed(2);
  };
  const overallCgstRate = calculateRate(totalCGST, salesBase);
  const overallSgstRate = calculateRate(totalSGST, salesBase);
  const overallIgstRate = calculateRate(totalIGST, salesBase);
  // Get the sales ledger name to use as the source for tax calculations
  const taxSourceLedger = uniqueItemLedgers.length === 1
    ? uniqueItemLedgers[0]
    : uniqueItemLedgers.length > 1
      ? uniqueItemLedgers[0]
      : 'Sales';

  if (totalCGST > 0 && cgstLedger) {
    allLedgerEntries.push({
      ledgerName: cgstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +totalCGST
    });
  }

  // 3. SGST
  if (totalSGST > 0 && sgstLedger) {
    allLedgerEntries.push({
      ledgerName: sgstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +totalSGST
    });
  }

  // 4. IGST
  if (totalIGST > 0 && igstLedger) {
    allLedgerEntries.push({
      ledgerName: igstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +totalIGST
    });
  }

  // Only add sales credit ledger entry if we're not using inventory entries
    // (inventory entries' ACCOUNTINGALLOCATIONS.LIST will handle the sales credit)
    if (!useInventory) {
      allLedgerEntries.push({
        ledgerName: salesCreditLedger,
        isDeemedPositive: false,
        isLastDeemedPositive: false,
        amount: totalTax > 0 ? +salesBase : +grandTotal,
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
      `(invoice ${invoiceNo}, grandTotal=${grandTotal}, cgst=${totalCGST}, sgst=${totalSGST}, igst=${totalIGST}, salesBase=${salesBase})`
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
    _grandTotal:  grandTotal,
    _totalCGST:   totalCGST,
    _totalSGST:   totalSGST,
    _totalIGST:   totalIGST,
    _salesBase:   salesBase,
    _useInventory: useInventory,
  };
}
