import fs from 'fs';
import path from 'path';

const logsDir = path.join(process.cwd(), 'logs', 'tally-xml-requests');
const files = fs.readdirSync(logsDir)
  .map(f => ({ name: f, time: fs.statSync(path.join(logsDir, f)).mtime }))
  .sort((a, b) => b.time - a.time)
  .slice(0, 15);

console.log('Searching in', files.length, 'files...');

let found = false;
for (const f of files) {
  const content = fs.readFileSync(path.join(logsDir, f.name), 'utf8');
  if (!content.includes('BIW01')) continue;
  found = true;
  console.log('\n=== BIW01 FOUND ===');
  console.log('File:', f.name);
  console.log('Time:', f.time);

  const check = (tag) => {
    const idx = content.indexOf(`<${tag}>`);
    if (idx >= 0) {
      console.log(`✓ ${tag}:`, content.substring(idx, Math.min(idx+80, content.length)).replace(/\n/g,' '));
    } else {
      console.log(`✗ ${tag}: MISSING`);
    }
  };

  check('CONSIGNEEPLACE');
  check('CONSIGNEESTATENAME');
  check('CONSIGNEENAME');
  check('BASICBUYERPLACE');
  check('BASICBUYERSTATENAME');
  check('STATENAME');
  check('PLACEOFSUPPLY');
  break;
}
if (!found) console.log('BIW01 not found in latest 15 XML files');
