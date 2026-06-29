import nodemailer from 'nodemailer';

// ─────────────────────────────────────────────────────────────────────────────
// Read SMTP credentials exclusively from the canonical .env keys:
//   EMAIL_HOST, EMAIL_PORT, EMAIL_USERNAME, EMAIL_PASSWORD, EMAIL_FROM
// Legacy SMTP_USER / SMTP_PASS are accepted as a fallback so old code doesn't
// break during a transition, but EMAIL_* always takes priority.
// ─────────────────────────────────────────────────────────────────────────────
const getCreds = () => ({
  host: (process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
  port: parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587', 10),
  user: (process.env.EMAIL_USERNAME || process.env.SMTP_USER || '').trim(),
  pass: (process.env.EMAIL_PASSWORD || process.env.SMTP_PASS || '').replace(/\s/g, ''),
  from: (process.env.EMAIL_FROM || '').trim(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Build a fresh transporter on every call so .env changes take effect on restart.
// Uses explicit host/port instead of service:'gmail' for full transparency.
// ─────────────────────────────────────────────────────────────────────────────
const makeTransporter = () => {
  const { host, port, user, pass } = getCreds();

  console.log('[email] host :', host);
  console.log('[email] port :', port);
  console.log('[email] user :', user || '(not set)');
  console.log('[email] pass :', pass ? `${pass.slice(0, 4)}...${pass.slice(-4)} (${pass.length} chars)` : '(not set)');

  if (!user) throw Object.assign(new Error('EMAIL_USERNAME missing in .env'), { code: 'CFG_NO_USER' });
  if (!pass) throw Object.assign(new Error('EMAIL_PASSWORD missing in .env'), { code: 'CFG_NO_PASS' });
  if (pass.length !== 16) {
    throw Object.assign(
      new Error(`EMAIL_PASSWORD is ${pass.length} chars — Gmail App Passwords must be exactly 16 chars. Do NOT use your regular Gmail password.`),
      { code: 'CFG_BAD_PASS' }
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    pool: false,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable error classifier
// ─────────────────────────────────────────────────────────────────────────────
export const classifySMTPError = (err) => {
  const s = `${err.code || ''} ${err.message || ''} ${err.response || ''}`.toLowerCase();

  if (/cfg_no_user|cfg_no_pass|cfg_bad_pass/.test(err.code)) {
    return { userMessage: `Email config error: ${err.message}`, code: err.code };
  }
  if (/535|badcredentials|username and password not accepted|invalid login|eauth/.test(s)) {
    return {
      userMessage:
        'Gmail App Password rejected (535 BadCredentials). ' +
        'The password in EMAIL_PASSWORD is invalid or revoked. ' +
        'Generate a new one at https://myaccount.google.com/apppasswords and update EMAIL_PASSWORD in backend .env, then restart the server.',
      code: 'EAUTH',
    };
  }
  if (/econnrefused|enotfound|etimedout/.test(s)) {
    return { userMessage: 'Cannot reach Gmail SMTP — check internet/firewall.', code: 'ENET' };
  }
  if (/quota|too many|rate/.test(s)) {
    return { userMessage: 'Gmail daily quota exceeded — try again later.', code: 'EQUOTA' };
  }
  return { userMessage: err.message || 'Email send failed', code: 'ESMTP' };
};

// ─────────────────────────────────────────────────────────────────────────────
// verifyTransporter — used by test-email diagnostic route
// ─────────────────────────────────────────────────────────────────────────────
export const verifyTransporter = async () => {
  const t = makeTransporter();
  await t.verify();
  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// sendEmail — main function used by vendorController
// ─────────────────────────────────────────────────────────────────────────────
export const sendEmail = async ({ to, subject, text, html }) => {
  const { user, from: fromEnv } = getCreds();
  const fromName  = process.env.SMTP_FROM_NAME || 'Sri Chakra Industries';
  const fromAddr  = fromEnv || user;
  const from      = `"${fromName}" <${fromAddr}>`;

  const transporter = makeTransporter();

  const info = await transporter.sendMail({ from, to, subject, text, html });
  console.log(`[email] ✅ Sent to ${to} | id: ${info.messageId}`);
  return info;
};

// ─────────────────────────────────────────────────────────────────────────────
// sendInvoiceEmail — used by invoice controller
// ─────────────────────────────────────────────────────────────────────────────
export const sendInvoiceEmail = async ({ to, partyName, invoice: inv, pdfBase64, pdfFilename }) => {
  const { user, from: fromEnv } = getCreds();
  const fromAddr = fromEnv || user;
  const from = `"Sri Chakra Industries" <${fromAddr}>`;
  const fmt  = (n) => `₹${(Number(n)||0).toLocaleString('en-IN',{minimumFractionDigits:2})}`;

  const transporter = makeTransporter();

  const info = await transporter.sendMail({
    from,
    to,
    subject: `Invoice ${inv.invoiceNo} from Sri Chakra Industries — ${partyName}`,
    text:    `Dear ${partyName},\n\nPlease find invoice ${inv.invoiceNo} attached.\nAmount: ${fmt(inv.grandTotal)}\n\nRegards,\nSri Chakra Industries`,
    html:    `<p>Dear ${partyName},<br>Invoice <strong>${inv.invoiceNo}</strong> — Amount: <strong>${fmt(inv.grandTotal)}</strong></p>`,
    attachments: [{ filename: pdfFilename, content: pdfBase64, encoding: 'base64', contentType: 'application/pdf' }],
  });

  console.log(`[email] ✅ Invoice sent to ${to} | id: ${info.messageId}`);
  return info;
};
