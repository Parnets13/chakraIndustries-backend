import fs from 'fs';
import path from 'path';

const logsDir = path.join(process.cwd(), 'logs', 'tally-xml-requests');
const files = fs.readdirSync(logsDir)
  .map(f => ({ name: f, time: fs.statSync(path.join(logsDir, f)).mtime }))
  .sort((a, b) => b.time - a.time)
  .slice(0, 10);

for (const f of files) {
  const content = fs.readFileSync(path.join(logsDir, f.name), 'utf8');
  // Extract voucher numbers
  const voucherNums = [...content.matchAll(/<VOUCHERNUMBER>([^<]+)<\/VOUCHERNUMBER>/g)].map(m => m[1]);
  console.log(f.time.toISOString().substring(11,19), f.name.substring(0,40), '→', voucherNums.join(', ') || '(no voucher)');
}
