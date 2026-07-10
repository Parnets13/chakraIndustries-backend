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
 * @param {string[]|null} options.gstLedgerNames  - GST ledger names fetched from Tally (can be null)
 * @param {string|null}   options.periodEnd       - YYYYMMDD period end cap (can be null)
 * @param {string|null}   options.companyName     - Tally company name (informational only)
 * @returns {Object} TallyVoucher sub-document (NOT a Mongoose model instance)
 * @throws {Error} if required fields missing or voucher is imbalanced
 */
export function normalizeToTallyVoucher(invoiceData, options = {}) {
  const { gstLedgerNames = null, periodEnd = null, salesVoucherTypeName = 'Sales' } = options;

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
  const cgstLedger = totalCGST > 0 ? resolveGstLedgerName('cgst', salesBase, totalCGST, gstLedgerNames) : '';
  const sgstLedger = totalSGST > 0 ? resolveGstLedgerName('sgst', salesBase, totalSGST, gstLedgerNames) : '';
  const igstLedger = totalIGST > 0 ? resolveGstLedgerName('igst', salesBase, totalIGST, gstLedgerNames) : '';

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
  const rawItemsTotal = +itemAmounts.reduce((s, a) => s + a, 0).toFixed(2);
  if (itemAmounts.length > 0 && Math.abs(rawItemsTotal - salesBase) <= 0.10 && rawItemsTotal !== salesBase) {
    const diff = +(salesBase - rawItemsTotal).toFixed(2);
    itemAmounts[itemAmounts.length - 1] = +(itemAmounts[itemAmounts.length - 1] + diff).toFixed(2);
  }
  const itemsTotal = +itemAmounts.reduce((s, a) => s + a, 0).toFixed(2);
  // useInventory: send items as ALLINVENTORYENTRIES.LIST when items exist and amounts balance.
  // Item-level ledger names are set inside the inventory builder — if no specific ledger
  // is known, we'll use 'Sales Accounts' and omit GSTLEDGERSOURCE tags there.
  const useInventory = validItems.length > 0 &&
    Math.abs(itemsTotal - salesBase) <= 0.10;

  const isInterstate = totalIGST > 0;

  const allInventoryEntries = useInventory ? validItems.map((item, i) => {
    const itemName   = (item.description || item.name || '').toString().trim();
    const itemQty    = +(item.qty || 1);
    const itemRate   = +(item.rate || 0);
    const itemAmount = itemAmounts[i];
    const itemUnit   = tallyUnit(item.unit || 'Nos');
    const itemHSN    = (item.hsn || '').toString().trim();
    // Sales ledger: use item.tallySalesLedger if set and valid, else 'Sales Accounts'
    // INVALID ledger names (must fall back to 'Sales Accounts'):
    //   - "Sales"          → partial/wrong name, not a Tally ledger (causes EXCEPTIONS=1)
    //   - "Sales Accounts" → Tally group name, not a ledger
    //   - any voucher type name (sales, purchase, receipt, etc.)
    //   - the item description/name itself → it's a stock item, not a ledger
    const INVALID_LEDGER_NAMES = new Set(['sales accounts', 'sales', 'purchase accounts', 'purchase', 'receipts', 'payments', '']);
    const TALLY_VOUCHER_TYPES = ['sales', 'purchase', 'receipt', 'payment', 'journal', 'contra', 'debit note', 'credit note', 'stock journal', 'vouchers'];
    const rawLedger = (item.tallySalesLedger || '').toString().trim();
    const rawLedgerLower = rawLedger.toLowerCase();
    const itemNameLower = itemName.toLowerCase();
    // Reject if it's an invalid name, a voucher type, or if it matches the stock item name
    // (item name used as fallback = not a real ledger)
    const isInvalidLedger = INVALID_LEDGER_NAMES.has(rawLedgerLower)
      || TALLY_VOUCHER_TYPES.includes(rawLedgerLower)
      || rawLedgerLower === itemNameLower;
    const salesLedger = (rawLedger && !isInvalidLedger) ? rawLedger : 'Sales Accounts';
    
    // Only emit GSTLEDGERSOURCE when salesLedger is NOT 'Sales Accounts'
    const hasSpecificLedger = salesLedger.toLowerCase() !== 'sales accounts';

    return {
      stockItemName:  itemName,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      rate:    `${itemRate.toFixed(2)}/${itemUnit}`,
      amount:  -itemAmount,
      actualQty: `${itemQty} ${itemUnit}`,
      billedQty:  `${itemQty} ${itemUnit}`,
      // GST source fields: only include when we have a specific (non-group) ledger
      gstSourceType:         hasSpecificLedger ? 'Ledger' : '',
      gstLedgerSource:       hasSpecificLedger ? salesLedger : '',
      hsnSourceType:         hasSpecificLedger ? 'Ledger' : '',
      hsnLedgerSource:       hasSpecificLedger ? salesLedger : '',
      gstOverrideTaxability: 'Taxable',
      gstOverrideSupplyType: 'Goods',
      gstHsnName:            itemHSN,
      accountingAllocations: [{
        ledgerName: salesLedger,
        isDeemedPositive: false,
        isLastDeemedPositive: false,
        amount: -itemAmount,
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
  if (totalCGST > 0 && cgstLedger) {
    allLedgerEntries.push({
      ledgerName: cgstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +totalCGST,
      billAllocations: [],
    });
  }

  // 3. SGST
  if (totalSGST > 0 && sgstLedger) {
    allLedgerEntries.push({
      ledgerName: sgstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +totalSGST,
      billAllocations: [],
    });
  }

  // 4. IGST
  if (totalIGST > 0 && igstLedger) {
    allLedgerEntries.push({
      ledgerName: igstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +totalIGST,
      billAllocations: [],
    });
  }

  // 5. Sales credit ledger.
  //    salesBase = grandTotal - totalTax
  //    When there is no tax, salesBase === grandTotal (correct).
  //
  //    CRITICAL: "Sales Accounts" is a Tally GROUP — NOT a ledger.
  //    Using a group name in LEDGERENTRIES.LIST causes silent EXCEPTIONS=1.
  //    We MUST use an actual ledger under the "Sales Accounts" group.
  //
  //    Resolution priority:
  //    1. If all items share the same tallySalesLedger → use that one ledger
  //    2. If items have mixed ledgers → use the first non-empty one
  //    3. Fallback: "Sales" — a generic ledger that is auto-created under
  //       "Sales Accounts" by the export pre-flight step. Never "Sales Accounts".
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

  allLedgerEntries.push({
    ledgerName: salesCreditLedger,
    isDeemedPositive: false,
    isLastDeemedPositive: false,
    amount: totalTax > 0 ? +salesBase : +grandTotal,
    billAllocations: [],
  });

  // ── Balance check ─────────────────────────────────────────────────────────
  // Debug: log all entries before validation so any future imbalance is traceable.
  console.log('[normalizeToTallyVoucher] DEBUG balance check for invoice', invoiceNo);
  console.log('  allLedgerEntries:');
  allLedgerEntries.forEach((e, i) =>
    console.log(`    [${i}] ${e.ledgerName} => amount=${e.amount}`)
  );
  console.log('  allInventoryEntries:');
  allInventoryEntries.forEach((e, i) =>
    console.log(`    [${i}] ${e.stockItemName} => amount=${e.amount}`)
  );
  console.log(`  Party Ledger amount  : ${-grandTotal}`);
  console.log(`  Sales Credit Ledger  : "${salesCreditLedger}" amount=${totalTax > 0 ? +salesBase : +grandTotal}`);
  console.log(`  CGST amount          : ${totalCGST}`);
  console.log(`  SGST amount          : ${totalSGST}`);
  console.log(`  IGST amount          : ${totalIGST}`);
  console.log(`  Sales Base           : ${salesBase}`);
  console.log(`  Grand Total          : ${grandTotal}`);

  // Tally requires sum of all ledger entry amounts = 0.
  // Party = -grandTotal (negative), GST + Sales credits = +grandTotal (positive sum).
  const ledgerSum = +allLedgerEntries.reduce((s, e) => s + e.amount, 0).toFixed(2);
  console.log(`  Final balance (sum)  : ${ledgerSum}  (must be 0 ± 0.01)`);

  if (Math.abs(ledgerSum) > 0.01) {
    throw new Error(
      `normalizeToTallyVoucher: voucher imbalanced by ${ledgerSum.toFixed(2)} ` +
      `(invoice ${invoiceNo}, grandTotal=${grandTotal}, cgst=${totalCGST}, sgst=${totalSGST}, igst=${totalIGST}, salesBase=${salesBase})`
    );
  }

  // ── Narration — COMPREHENSIVE item details (Tally config blocks inventory XML) ──
  // This Tally company does NOT accept ALLINVENTORYENTRIES.LIST via XML import.
  // All item details (name, qty, rate, amount) MUST go in NARRATION as plain text
  // so they appear in Tally's voucher view and sales register.
  const origDateFmt = invoiceData.invoiceDate
    ? new Date(invoiceData.invoiceDate).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })
    : '';
  const poRef = (invoiceData.buyersOrderNo || invoiceData.purchaseOrderRef || '').toString().trim();
  
  // Build item-by-item breakdown for narration
  const itemLines = validItems.map((item, i) => {
    const itemName   = (item.description || item.name || '').toString().trim();
    const itemQty    = +(item.qty || 1);
    const itemRate   = +(item.rate || 0);
    const itemAmount = itemAmounts[i];
    const itemUnit   = tallyUnit(item.unit || 'Nos');
    // Format: "1. HYDRA STEEL WATER BOTTLE 1000ML: 50 Nos @ ₹150.00 = ₹7,500.00"
    return `${i + 1}. ${itemName}: ${itemQty} ${itemUnit} @ ₹${itemRate.toFixed(2)} = ₹${itemAmount.toFixed(2)}`;
  });
  
  const narration = [
    `Invoice: ${invoiceNo}`,
    origDateFmt ? `Date: ${origDateFmt}` : null,
    poRef ? `PO: ${poRef}` : null,
    '', // blank line separator
    ...itemLines,
    '', // blank line before notes
    invoiceData.notes || null,
  ].filter(x => x !== null).join('\n');

  // ── Assemble sub-document ─────────────────────────────────────────────────
  // ── PO Date → YYYYMMDD ────────────────────────────────────────────────────
  const rawPoDate = invoiceData.poDate || '';
  const poDateTally = rawPoDate ? (toTallyDate(rawPoDate) || '') : '';

  // ── Ship To fields ────────────────────────────────────────────────────────
  const shipToName    = (invoiceData.shipToName    || invoiceData.shipToMailingName || '').toString().trim();
  const shipToAddress = (invoiceData.shipToAddress || '').toString().trim();
  const shipToCity    = (invoiceData.shipToCity    || '').toString().trim();
  const shipToState   = (invoiceData.shipToState   || '').toString().trim();
  const shipToGST     = (invoiceData.shipToGST     || '').toString().trim();

  // ── Bill To fields ────────────────────────────────────────────────────────
  const billToName    = (invoiceData.billToName    || invoiceData.billToMailingName || partyLedgerName).toString().trim();
  const billToAddress = (invoiceData.billToAddress || invoiceData.partyAddress || '').toString().trim();
  const billToCity    = (invoiceData.billToCity    || invoiceData.partyCity    || '').toString().trim();
  const billToState   = (invoiceData.billToState   || invoiceData.partyState   || '').toString().trim();
  const billToGST     = (invoiceData.billToGST     || invoiceData.partyGST     || '').toString().trim();

  console.log(`[normalizeToTallyVoucher] DEBUG extra fields for invoice ${invoiceNo}`);
  console.log(`  poDate       : "${rawPoDate}" → tally="${poDateTally}"`);
  console.log(`  shipToName   : "${shipToName}"`);
  console.log(`  shipToAddress: "${shipToAddress}"`);
  console.log(`  billToName   : "${billToName}"`);
  console.log(`  buyersOrderNo: "${(invoiceData.buyersOrderNo || invoiceData.purchaseOrderRef || '')}"`);

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
    // Ship To — written to BASICBASEPARTYDETAILS.LIST in Tally XML
    shipToName,
    shipToAddress,
    shipToCity,
    shipToState,
    shipToGST,
    // Bill To — written to ADDRESS.LIST in Tally XML
    billToName,
    billToAddress,
    billToCity,
    billToState,
    billToGST,
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
