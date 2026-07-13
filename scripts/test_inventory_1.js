
// Test 1 as per user instructions:
// - Add bare minimum ALLINVENTORYENTRIES.LIST
// - Remove "SS Bottle Sales Local 5%" from ledger entries
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// First, let's check what Tally config is present
console.log('Test 1: Starting...');
console.log('Test 1: Creating XML request for Sales voucher with inventory');

// Build exactly the XML as per user's TEST 1 instructions
const voucherNumber = 'TEST-INV-001';
const xml = `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <DATE>20260712</DATE>
            <EFFECTIVEDATE>20260712</EFFECTIVEDATE>
            <VOUCHERNUMBER>${voucherNumber}</VOUCHERNUMBER>
            <PARTYLEDGERNAME>BIW01 (Test Party)</PARTYLEDGERNAME>
            <ISINVOICE>Yes</ISINVOICE>
            <NARRATION>Test 1 - Inventory Bare Minimum</NARRATION>
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>BIW01 (Test Party)</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
              <AMOUNT>-200.00</AMOUNT>
              <BILLALLOCATIONS.LIST>
                <NAME>${voucherNumber}</NAME>
                <BILLTYPE>New Ref</BILLTYPE>
                <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
                <AMOUNT>-200.00</AMOUNT>
              </BILLALLOCATIONS.LIST>
            </LEDGERENTRIES.LIST>
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>CGST</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
              <AMOUNT>4.76</AMOUNT>
            </LEDGERENTRIES.LIST>
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>SGST</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
              <AMOUNT>4.76</AMOUNT>
            </LEDGERENTRIES.LIST>
            <!-- Removed "SS Bottle Sales Local 5%" ledger entry -->
            <ALLINVENTORYENTRIES.LIST>
              <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
              <RATE>190.48/Nos</RATE>
              <AMOUNT>190.48</AMOUNT>
              <ACTUALQTY>1 Nos</ACTUALQTY>
              <BILLEDQTY>1 Nos</BILLEDQTY>
              <ACCOUNTINGALLOCATIONS.LIST>
                <LEDGERNAME>SS Bottle Sales Local 5%</LEDGERNAME>
                <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
                <AMOUNT>190.48</AMOUNT>
              </ACCOUNTINGALLOCATIONS.LIST>
            </ALLINVENTORYENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

// Save test XML to logs
const logDir = path.join(__dirname, '..', 'logs', 'tally-xml-requests');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const xmlPath = path.join(logDir, `test-1-${timestamp}.xml`);
fs.writeFileSync(xmlPath, xml, 'utf8');
console.log(`Test 1: Saved XML to ${xmlPath}`);
console.log('\nTest 1: Calculated balance:');
console.log('  Party debit: -200.00');
console.log('  CGST credit: +4.76');
console.log('  SGST credit: +4.76');
console.log('  Sales credit (inventory): +190.48');
console.log('  Sum: -200 +4.76 +4.76 +190.48 = 0');

console.log('\nTest 1: XML content generated (raw):');
console.log(xml);
