#!/usr/bin/env node
import fs from 'fs/promises';

async function checkFile() {
  const xmlPath = 'd:\\chakraproject\\chakraIndustries-backend\\test-voucher.xml';

  console.log(`Checking file: ${xmlPath}\n`);

  // Read the file as a buffer
  const buffer = await fs.readFile(xmlPath);
  const text = buffer.toString('utf8');

  // Find the <VOUCHER tag
  const voucherIdx = text.indexOf('<VOUCHER');
  if (voucherIdx !== -1) {
    const snippet = text.slice(voucherIdx, voucherIdx + 300);
    console.log("--- VOUCHER tag and following content ---");
    console.log(snippet);
    console.log("\n--- Hex dump of that section ---");
    const snippetBuffer = buffer.subarray(voucherIdx, voucherIdx + 300);
    let hexStr = "";
    let asciiStr = "";

    for (let i = 0; i < snippetBuffer.length; i++) {
      const byte = snippetBuffer[i];
      hexStr += byte.toString(16).padStart(2, '0') + " ";
      const char = byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : (byte === 10 ? "\\n" : byte === 13 ? "\\r" : ".");
      asciiStr += char;

      if ((i + 1) % 16 === 0) {
        console.log(`  ${hexStr}  ${asciiStr}`);
        hexStr = "";
        asciiStr = "";
      }
    }
    if (hexStr) {
      console.log(`  ${hexStr.padEnd(48)}  ${asciiStr}`);
    }
  }

  // Check for UTF-8 BOM (EF BB BF)
  const hasBom = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
  console.log(`\nUTF-8 BOM present? ${hasBom ? 'YES (EF BB BF)' : 'NO'}`);

  // Show the <DATE> tag section
  console.log("\n--- <DATE> tag section ---");
  const dateTagStart = text.indexOf('<DATE>');
  if (dateTagStart !== -1) {
    const snippet = text.slice(dateTagStart, dateTagStart + 100);
    console.log(snippet);
    const dateValue = snippet.slice(6, snippet.indexOf('</DATE>'));
    console.log(`  Date value length: ${dateValue.length}`);
    console.log(`  Date value: "${dateValue}"`);
  }
}

checkFile().catch(console.error);
