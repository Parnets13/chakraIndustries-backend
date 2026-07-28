import fs from 'fs';
import path from 'path';

const logsDir = path.join(process.cwd(), 'logs', 'tally-xml-requests');
const files = fs.readdirSync(logsDir)
  .map(f => ({ name: f, time: fs.statSync(path.join(logsDir, f)).mtime }))
  .sort((a, b) => b.time - a.time)
  .slice(0, 30);

// Check BIW08, BIW09 etc
const targets = ['BIW08', 'BIW09', 'BIW03', 'BIW05'];

for (const f of files) {
  const content = fs.readFileSync(path.join(logsDir, f.name), 'utf8');
  const vnum = [...content.matchAll(/<VOUCHERNUMBER>([^<]+)<\/VOUCHERNUMBER>/g)].map(m => m[1]);
  if (!vnum.some(v => targets.includes(v))) continue;

  console.log('\n=== FILE:', f.name, f.time.toISOString().substring(0,19));
  console.log('Vouchers:', vnum.join(', '));

  const checkTag = (tag) => {
    const idx = content.indexOf(`<${tag}>`);
    if (idx >= 0) {
      const val = content.substring(idx + tag.length + 2, content.indexOf(`</${tag}>`, idx));
      console.log(`  ${tag}: "${val}"`);
    } else {
      console.log(`  ${tag}: MISSING`);
    }
  };

  checkTag('CONSIGNEEPLACE');
  checkTag('CONSIGNEESTATENAME');
  checkTag('CONSIGNEENAME');
  checkTag('BASICBUYERPLACE');
  checkTag('PLACEOFSUPPLY');
  break;
}
