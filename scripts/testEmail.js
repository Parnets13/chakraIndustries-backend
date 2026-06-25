/**
 * Run this to test SMTP credentials BEFORE starting the server:
 *   node scripts/testEmail.js
 */
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

// Read canonical EMAIL_* keys (with SMTP_* as legacy fallback)
const host = (process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com').trim();
const port = parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587', 10);
const user = (process.env.EMAIL_USERNAME || process.env.SMTP_USER || '').trim();
const pass = (process.env.EMAIL_PASSWORD || process.env.SMTP_PASS || '').replace(/\s/g, '');
const from = (process.env.EMAIL_FROM || '').trim();

console.log('\n📧 SMTP Test');
console.log('─────────────────────────────────');
console.log('EMAIL_HOST     :', host);
console.log('EMAIL_PORT     :', port);
console.log('EMAIL_USERNAME :', user);
console.log('EMAIL_PASSWORD :', pass ? `${pass.slice(0, 4)}****${pass.slice(-4)} (${pass.length} chars)` : '❌ MISSING');
console.log('EMAIL_FROM     :', from || '(not set — will use EMAIL_USERNAME)');
console.log('─────────────────────────────────\n');

if (!user || !pass) {
  console.error('❌ EMAIL_USERNAME or EMAIL_PASSWORD is missing in .env');
  process.exit(1);
}

if (pass.length !== 16) {
  console.error(`❌ EMAIL_PASSWORD is ${pass.length} chars — Gmail App Passwords must be exactly 16 chars.`);
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
  tls: { rejectUnauthorized: false },
});

try {
  console.log('🔄 Verifying SMTP connection...');
  await transporter.verify();
  console.log('✅ SMTP connection successful! Credentials are valid.\n');

  const sendTo = from || user;
  console.log('🔄 Sending test email to:', sendTo);
  const info = await transporter.sendMail({
    from: `"Sri Chakra ERP Test" <${from || user}>`,
    to: sendTo,
    subject: 'ERP Email Test ✅',
    text: 'If you see this, your SMTP config is working correctly.',
    html: '<p>If you see this, your <strong>SMTP config is working correctly</strong>.</p>',
  });
  console.log('✅ Test email sent! Message ID:', info.messageId);
  console.log('📬 Check inbox of:', sendTo);
} catch (err) {
  console.error('❌ SMTP Error:', err.message);
  console.error('   Code:', err.code);
  if (err.responseCode === 535 || /535|badcredentials|eauth/i.test(err.message)) {
    console.error('\n⚠️  Fix: App Password is invalid or expired.');
    console.error('   1. Go to: https://myaccount.google.com/apppasswords');
    console.error('   2. Sign in as:', user);
    console.error('   3. Create a new App Password → copy the 16-char code');
    console.error('   4. Update EMAIL_PASSWORD in backend/.env');
    console.error('   5. Restart backend server\n');
  }
  process.exit(1);
}
