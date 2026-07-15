#!/usr/bin/env node
/**
 * test-normalize-standalone.js
 * Test normalizeToTallyVoucher with fake data
 */
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

const fakeInvoice = {
  invoiceNo: "BIW01",
  partyName: "Test Party",
  invoiceDate: "2025-01-01",
  grandTotal: 1180,
  cgstTotal: 90,
  sgstTotal: 90,
  igstTotal: 0,
  items: [
    {
      description: "Test Item",
      qty: 1,
      rate: 1000,
      amount: 1000,
      cgst: 90,
      sgst: 90,
      igst: 0,
      tallySalesLedger: "Test Sales Ledger",
      hsn: "123456"
    }
  ]
};

console.log("Testing normalizeToTallyVoucher...");

try {
  const result = normalizeToTallyVoucher(fakeInvoice, {});
  console.log("✅ Success!");
  console.log("Result:", JSON.stringify(result, null, 2));

  // Check if tax ledger entries have rateDetails with sourceLedger
  console.log("\nChecking tax ledger entries:");
  result.allLedgerEntries.forEach(entry => {
    if (entry.ledgerName.toLowerCase().includes('cgst') || 
        entry.ledgerName.toLowerCase().includes('sgst') || 
        entry.ledgerName.toLowerCase().includes('igst')) {
      console.log(`  ✅ ${entry.ledgerName}:`, JSON.stringify(entry, null, 4));
    }
  });

} catch (err) {
  console.error("❌ Error:", err);
  process.exit(1);
}
