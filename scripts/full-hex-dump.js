#!/usr/bin/env node
import fs from 'fs/promises';

async function main() {
  const xmlPath = 'd:\\chakraproject\\chakraIndustries-backend\\test-voucher.xml';
  const buffer = await fs.readFile(xmlPath);
  console.log('Full raw hex dump of test-voucher.xml (all bytes):');
  console.log('='.repeat(80));

  for (let offset = 0; offset < buffer.length; offset += 16) {
    const lineBytes = buffer.subarray(offset, offset + 16);
    const hexParts = [];
    const asciiParts = [];

    for (let i = 0; i < 16; i++) {
      if (i < lineBytes.length) {
        const byte = lineBytes[i];
        hexParts.push(byte.toString(16).padStart(2, '0'));
        const char = (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
        asciiParts.push(char);
      } else {
        hexParts.push('  ');
        asciiParts.push(' ');
      }
    }

    const offsetStr = offset.toString().padStart(8, '0');
    const hexLine = hexParts.join(' ');
    const asciiLine = asciiParts.join('');
    console.log(`${offsetStr}  ${hexLine}  |${asciiLine}|`);
  }

  console.log('\n\n=== Complete file content (text view): ===');
  console.log(buffer.toString('utf8'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
