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
  const { gstLedgerNames = null, periodEnd = null } = options;

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
  const itemsTotal = +itemAmounts.reduce((s, a) => s + a, 0).toFixed(2);
  // useInventory requires: items exist, amounts balance, AND every item has a
  // specific sales ledger (not the generic "Sales Accounts" group fallback).
  const allItemsHaveSpecificLedger = validItems.length > 0 &&
    validItems.every(item => (item.tallySalesLedger || '').toString().trim() &&
      (item.tallySalesLedger || '').toString().trim().toLowerCase() !== 'sales accounts');
  const useInventory = validItems.length > 0 &&
    Math.abs(itemsTotal - salesBase) <= 0.01 &&
    allItemsHaveSpecificLedger;

  const isInterstate = totalIGST > 0;

  const allInventoryEntries = useInventory ? validItems.map((item, i) => {
    const itemName   = (item.description || item.name || '').toString().trim();
    const itemQty    = +(item.qty || 1);
    const itemRate   = +(item.rate || 0);
    const itemAmount = itemAmounts[i];
    const itemUnit   = tallyUnit(item.unit || 'Nos');
    const itemHSN    = (item.hsn || '').toString().trim();
    // Sales ledger name: use item.tallySalesLedger if provided, else 'Sales Accounts'
    // The correct per-item name (if known) should be passed via item.tallySalesLedger
    // at the time normalizeToTallyVoucher is called. Falls back to 'Sales Accounts'
    // which is the universal default Tally sales group ledger.
    const salesLedger = (item.tallySalesLedger || '').toString().trim() || 'Sales Accounts';
    return {
      stockItemName:  itemName,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      rate:    `${itemRate.toFixed(2)}/${itemUnit}`,     // Tally format: "100.00/Nos"
      amount:  -itemAmount,                              // negative = credit for sales
      actualQty: `${itemQty} ${itemUnit}`,
      billedQty:  `${itemQty} ${itemUnit}`,
      // GST source fields — tell Tally to derive GST/HSN from the named sales ledger
      gstSourceType:         'Ledger',
      gstLedgerSource:       salesLedger,
      hsnSourceType:         'Ledger',
      hsnLedgerSource:       salesLedger,
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

  // 5. Sales Accounts credit.
  //    salesBase = grandTotal - totalTax
  //    When there is no tax, salesBase === grandTotal (correct).
  allLedgerEntries.push({
    ledgerName: 'Sales Accounts',
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
  console.log(`  Sales Ledger amount  : ${totalTax > 0 ? +salesBase : +grandTotal}`);
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

  // ── Narration ─────────────────────────────────────────────────────────────
  const origDateFmt = invoiceData.invoiceDate
    ? new Date(invoiceData.invoiceDate).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })
    : '';
  const itemSummary = validItems.map(i => `${(i.description||i.name||'')} x${i.qty||1}`).join(', ');
  const narration = [
    `ERP Inv: ${invoiceNo}`,
    origDateFmt ? `Invoice Date: ${origDateFmt}` : null,
    itemSummary || null,
    invoiceData.purchaseOrderRef ? `PO: ${invoiceData.purchaseOrderRef}` : null,
    invoiceData.notes || null,
  ].filter(Boolean).join(' | ');

  // ── Assemble sub-document ─────────────────────────────────────────────────
  return {
    voucherType:      'Sales',
    voucherNumber:    invoiceNo,
    date:             voucherDate,
    effectiveDate:    voucherDate,
    partyLedgerName,
    isinvoice:        true,
    buyersOrderNo:    (invoiceData.buyersOrderNo || invoiceData.purchaseOrderRef || '').toString().trim(),
    narration,
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
