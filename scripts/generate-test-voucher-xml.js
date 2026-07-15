#!/usr/bin/env node
/**
 * generate-test-voucher-xml.js
 * Generates a single clean test voucher XML for manual import into Tally
 */
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';

// Fake invoice data with real masters
const testInvoice = {
  invoiceNo: "GSTTEST01",
  partyName: "BI Worldwide India PVT LTD",
  invoiceDate: "2026-07-14",
  grandTotal: 1180.00,
  cgstTotal: 90.00,
  sgstTotal: 90.00,
  igstTotal: 0,
  partyGST: "29AAGCR3307L1Z4", // Real party GSTIN
  partyState: "Karnataka",
  billToState: "Karnataka",
  billToGST: "29AAGCR3307L1Z4",
  items: [
    {
      description: "HYDRA STEEL WATER BOTTLE 1000ML",
      qty: 2,
      rate: 500.00,
      amount: 1000.00,
      cgst: 90.00,
      sgst: 90.00,
      igst: 0,
      tallySalesLedger: "SS Bottle Sales Local 5%",
      hsn: "3923"
    }
  ]
};

// Mock TallyConfig with real company details
const mockCfg = {
  gstin: "29ABWFS0002M1ZR",
  state: "Karnataka"
};

console.log("Generating test voucher XML...");

try {
  // 1. Normalize
  const tv = normalizeToTallyVoucher(testInvoice, {});
  console.log("✅ Normalize successful!");

  // 2. Serialize
  const xml = serializeTallyVoucher(tv, mockCfg, 'Create', '');
  
  // 3. Wrap in full Tally ENVELOPE
  const fullXml = `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>SRI CHAKRA INDUSTRIES</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
${xml}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  // 4. Write to file
  const fs = await import('fs/promises');
  const outputPath = 'd:\\chakraproject\\chakraIndustries-backend\\test-voucher.xml';
  await fs.writeFile(outputPath, fullXml, 'utf-8');
  
  console.log("\n✅ Test XML generated successfully!");
  console.log(`📄 File saved at: ${outputPath}`);
  console.log("\n--- Preview of generated XML ---");
  console.log(fullXml);
  
} catch (err) {
  console.error("\n❌ Error generating test XML:", err);
  process.exit(1);
}
