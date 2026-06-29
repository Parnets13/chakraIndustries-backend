#!/usr/bin/env node
import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    parseAttributeValue: false,
    allowBooleanAttributes: true,
    ignoreDeclaration: true,
    trimValues: false,
    processEntities: true,
    arrayMode: (tagName, jPath, isLeafNode, isAttribute) => {
        return ['LEDGER', 'STOCKITEM', 'VOUCHER',
          'TALLYMESSAGE',
          'ALLLEDGERENTRIES.LIST', 'LEDGERENTRIES.LIST',
          'ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST',
          'BILLALLOCATIONS.LIST', 'BATCHALLOCATIONS.LIST',
          'ACCOUNTINGALLOCATIONS.LIST', 'GSTADVADJDETAILS.LIST',
          'ADDRESS', 'BASICBUYERADDRESS', 'DISPATCHFROMADDRESS',
        ].includes(tagName);
    }
});

function getSafeValue(obj, key, defaultValue = '') {
    if (!obj) return defaultValue;
    let value = obj[key];
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === 'object' && !Array.isArray(value)) {
        value = value['#text'] ?? value['_text'] ?? value['$t'] ?? '';
    }
    if (value === '' || value === null || value === undefined) return defaultValue;
    return String(value).replace(/[\r\n]+/g, ' ');
}

function decodeXmlEntities(s) {
    if (!s) return '';
    return String(s)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/[\r\n]+/g, ' ');
}

// Test cases: Test the exact examples from the user's issue
const testXML = `
<ENVELOPE>
  <BODY>
    <DATA>
      <COLLECTION>
        <LEDGER NAME="VISHAALS KITCHENWARE LLP (7th Block)">
          <LANGUAGENAME.LIST>
            <NAME.LIST>
              <NAME>VISHAALS HOME STORES RETAIL PVT LTD</NAME>
              <TYPE>String</TYPE>
            </NAME.LIST>
            <LANGUAGEID>1033</LANGUAGEID>
          </LANGUAGENAME.LIST>
          <RESERVEDNAME></RESERVEDNAME>
        </LEDGER>
        <!-- Test with newlines in name -->
        <LEDGER NAME="VISHAALS HOME STORES RETAIL PVT
LTD">
          <LANGUAGENAME.LIST>
            <NAME.LIST>
              <NAME>VISHAALS HOME STORES RETAIL PVT
LTD</NAME>
              <TYPE>String</TYPE>
            </NAME.LIST>
            <LANGUAGEID>1033</LANGUAGEID>
          </LANGUAGENAME.LIST>
          <RESERVEDNAME></RESERVEDNAME>
        </LEDGER>
        <!-- Test with special characters -->
        <LEDGER NAME="Vishwas Printing &amp; Packaging">
          <LANGUAGENAME.LIST>
            <NAME.LIST>
              <NAME>Vishwas Printing &amp; Packaging</NAME>
              <TYPE>String</TYPE>
            </NAME.LIST>
            <LANGUAGEID>1033</LANGUAGEID>
          </LANGUAGENAME.LIST>
          <RESERVEDNAME></RESERVEDNAME>
        </LEDGER>
        <!-- Test all user's exact test cases -->
        <LEDGER NAME="Xpress Home Needs Supermarket">
          <LANGUAGENAME.LIST>
            <NAME.LIST>
              <NAME>Xpress Home Needs Supermarket</NAME>
              <TYPE>String</TYPE>
            </NAME.LIST>
            <LANGUAGEID>1033</LANGUAGEID>
          </LANGUAGENAME.LIST>
          <RESERVEDNAME></RESERVEDNAME>
        </LEDGER>
        <LEDGER NAME="Zimson Times Pvt Ltd (New BEL)">
          <LANGUAGENAME.LIST>
            <NAME.LIST>
              <NAME>Zimson Times Pvt Ltd (New BEL)</NAME>
              <TYPE>String</TYPE>
            </NAME.LIST>
            <LANGUAGEID>1033</LANGUAGEID>
          </LANGUAGENAME.LIST>
          <RESERVEDNAME></RESERVEDNAME>
        </LEDGER>
        <LEDGER NAME="VRL Logistics ( Creditors)">
          <LANGUAGENAME.LIST>
            <NAME.LIST>
              <NAME>VRL Logistics ( Creditors)</NAME>
              <TYPE>String</TYPE>
            </NAME.LIST>
            <LANGUAGEID>1033</LANGUAGEID>
          </LANGUAGENAME.LIST>
          <RESERVEDNAME></RESERVEDNAME>
        </LEDGER>
        <LEDGER NAME="WATCH WORLD (A.P)">
          <LANGUAGENAME.LIST>
            <NAME.LIST>
              <NAME>WATCH WORLD (A.P)</NAME>
              <TYPE>String</TYPE>
            </NAME.LIST>
            <LANGUAGEID>1033</LANGUAGEID>
          </LANGUAGENAME.LIST>
          <RESERVEDNAME></RESERVEDNAME>
        </LEDGER>
        <LEDGER NAME="Wood & Wicker Gallerie">
          <LANGUAGENAME.LIST>
            <NAME.LIST>
              <NAME>Wood & Wicker Gallerie</NAME>
              <TYPE>String</TYPE>
            </NAME.LIST>
            <LANGUAGEID>1033</LANGUAGEID>
          </LANGUAGENAME.LIST>
          <RESERVEDNAME></RESERVEDNAME>
        </LEDGER>
      </COLLECTION>
    </DATA>
  </BODY>
</ENVELOPE>
`;

console.log("=== Testing XML Parsing Test ===");
console.log("1. Parsing test XML...");
const parsed = xmlParser.parse(testXML);
console.log("✅ XML parsed successfully!");

console.log("\n=== Checking ledgers found:", parsed.ENVELOPE.BODY.DATA.COLLECTION.LEDGER);

console.log("\n=== Testing getSafeValue and decodeXmlEntities ===");

const testLedgers = parsed.ENVELOPE.BODY.DATA.COLLECTION.LEDGER;

let allPassed = true;
const expectedNames = [
    "VISHAALS KITCHENWARE LLP (7th Block)",
    "VISHAALS HOME STORES RETAIL PVT LTD",
    "Vishwas Printing & Packaging",
    "Xpress Home Needs Supermarket",
    "Zimson Times Pvt Ltd (New BEL)",
    "VRL Logistics ( Creditors)",
    "WATCH WORLD (A.P)",
    "Wood & Wicker Gallerie"
];
let idx = 0;

testLedgers.forEach(ledger => {
    const name = decodeXmlEntities(getSafeValue(ledger, '@_NAME'));
    const expected = expectedNames[idx];
    console.log(`Testing ledger ${idx}: "${name}"`);
    if (name !== expected) {
        allPassed = false;
        console.error(`❌ FAILURE: Expected "${expected}" but got "${name}"!`);
    } else {
        console.log("✅ SUCCESS: Name matches exactly!");
    }
    idx++;
});

console.log("\n=== Final Result ===");
if (allPassed) {
    console.log("🎉 All tests passed! Parsing is working correctly!");
} else {
    console.error("😢 Some tests failed!");
    process.exit(1);
}
