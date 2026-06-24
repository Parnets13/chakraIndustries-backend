import nodemailer from 'nodemailer';

// ── Gmail SMTP Transporter ────────────────────────────────────────────────────
// Credentials loaded from .env:
//   SMTP_USER  = madhusewingm@gmail.com
//   SMTP_PASS  = Gmail App Password (16 chars, spaces allowed)
//   SMTP_HOST  = smtp.gmail.com
//   SMTP_PORT  = 587

const createTransporter = () => {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').replace(/\s/g, ''); // strip spaces from app password
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = parseInt(process.env.SMTP_PORT || '587', 10);

  if (!user || !pass) {
    throw new Error('SMTP credentials missing. Set SMTP_USER and SMTP_PASS in backend .env');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,          // true for 465, false for 587
    auth: { user, pass },
    tls:  { rejectUnauthorized: false },
  });
};

const getFrom = () => {
  const name  = process.env.SMTP_FROM_NAME  || 'Sri Chakra Industries';
  const email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '';
  return `"${name}" <${email}>`;
};

// ── sendEmail ─────────────────────────────────────────────────────────────────
// Used by vendorController to send RFQ email to vendor
export const sendEmail = async ({ to, subject, text, html }) => {
  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: getFrom(),
    to,
    subject,
    text,
    html,
  });
  console.log(`✅ Email sent to ${to} — MessageId: ${info.messageId}`);
  return info;
};

// ── sendInvoiceEmail ──────────────────────────────────────────────────────────
export const sendInvoiceEmail = async ({ to, partyName, invoice: inv, pdfBase64, pdfFilename }) => {
  const transporter = createTransporter();

  const fmtAmt = (n) =>
    `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const info = await transporter.sendMail({
    from:    getFrom(),
    to,
    subject: `Invoice ${inv.invoiceNo} from Sri Chakra Industries — ${partyName}`,
    text:    `Dear ${partyName},\n\nPlease find invoice ${inv.invoiceNo} attached.\nAmount: ${fmtAmt(inv.grandTotal)}\n\nRegards,\nSri Chakra Industries`,
    html:    `<p>Dear ${partyName},<br>Invoice <strong>${inv.invoiceNo}</strong> attached. Amount: <strong>${fmtAmt(inv.grandTotal)}</strong></p>`,
    attachments: [{
      filename:    pdfFilename,
      content:     pdfBase64,
      encoding:    'base64',
      contentType: 'application/pdf',
    }],
  });

  console.log(`✅ Invoice email sent to ${to} — MessageId: ${info.messageId}`);
  return info;
};
