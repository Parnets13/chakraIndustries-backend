#!/usr/bin/env node
/**
 * detailed-hex-dump.js: Inspects test-voucher.xml's <DATE> tag area with
 * exact byte positions, hex, and ASCII.
 */
import fs from 'fs/promises';

async function main() {
  const xmlPath = 'd:\\chakraproject\\chakraIndustries-backend\\test-voucher.xml';
  const buffer = await fs.readFile(xmlPath);
  const text = buffer.toString('utf8');

  // Find <DATE> tag positions
  const dateStartIdx = text.indexOf('<DATE>');
  const dateEndIdx = text.indexOf('</DATE>') + '</DATE>'.length;

  if (dateStartIdx === -1) {
    console.error('ERROR: <DATE> tag not found');
    return;
  }

  // Show 50 bytes before <DATE>, 100 bytes after <DATE> starts
  const showStart = Math.max(0, dateStartIdx - 50);
  const showEnd = Math.min(buffer.length, dateStartIdx + 150);
  const excerptBuffer = buffer.subarray(showStart, showEnd);

  console.log('--- Detailed Hex Dump Around <DATE> Tag ---');
  console.log(`Showing bytes ${showStart} to ${showEnd} of ${buffer.length}`);
  console.log();

  // Print hex dump with 16-byte lines
  for (let offset = 0; offset < excerptBuffer.length; offset += 16) {
    const lineBytes = excerptBuffer.subarray(offset, offset + 16);
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

    const globalOffset = showStart + offset;
    console.log(
      `${globalOffset.toString().padStart(6)}  ` +
      hexParts.join(' ') + '  |' + asciiParts.join('') + '|'
    );
  }

  console.log();
  console.log('--- As Text ---');
  console.log(text.slice(showStart, showEnd));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
