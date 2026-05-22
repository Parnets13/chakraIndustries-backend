import nodemailer from 'nodemailer';

const createTransporter = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('Email not configured. Set SMTP_USER and SMTP_PASS in .env');
  }
  return nodemailer.createTransport({
    host:   SMTP_HOST  || 'smtp.gmail.com',
    port:   parseInt(SMTP_PORT || '587'),
    secure: parseInt(SMTP_PORT || '587') === 465,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
  });
};

export const sendInvoiceEmail = async ({ to, partyName, invoice: inv, pdfBase64, pdfFilename }) => {
  const transporter = createTransporter();
  const fromName    = process.env.SMTP_FROM_NAME || 'Sri Chakra Industries';
  const fromEmail   = process.env.SMTP_USER;

  const fmtDate = (d) => {
    try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d || ''; }
  };
  const fmtAmt = (n) =>
    `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const item = inv.items?.[0] || {};

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
  <tr><td align="center">
  <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <!-- Header -->
    <tr>
      <td style="background:linear-gradient(135deg,#c0392b 0%,#922b21 100%);padding:32px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Sri Chakra Industries</div>
            <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.7);letter-spacing:3px;text-transform:uppercase;margin-top:4px;">ERP Platform</div>
          </td>
          <td align="right">
            <div style="background:rgba(255,255,255,0.15);border-radius:10px;padding:10px 18px;display:inline-block;">
              <div style="font-size:11px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:1px;font-weight:600;">Tax Invoice</div>
              <div style="font-size:20px;font-weight:800;color:#fff;margin-top:2px;">${inv.invoiceNo}</div>
              <div style="font-size:12px;color:rgba(255,255,255,0.75);margin-top:2px;">${fmtDate(inv.invoiceDate)}</div>
            </div>
          </td>
        </tr></table>
      </td>
    </tr>

    <!-- Greeting -->
    <tr><td style="padding:32px 40px 0;">
      <p style="margin:0;font-size:16px;font-weight:600;color:#0f172a;">Dear ${partyName},</p>
      <p style="margin:12px 0 0;font-size:14px;color:#475569;line-height:1.7;">
        Greetings from <strong>Sri Chakra Industries</strong>! Please find the invoice attached to this email as a PDF.
        The details of your order are summarised below for your reference.
      </p>
    </td></tr>

    <!-- Invoice Details -->
    <tr><td style="padding:24px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr><td colspan="2" style="background:#0f172a;padding:12px 20px;">
          <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;">Invoice Details</span>
        </td></tr>
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;width:50%;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Invoice No.</div>
            <div style="font-size:14px;font-weight:700;color:#c0392b;margin-top:3px;font-family:monospace;">${inv.invoiceNo}</div>
          </td>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Invoice Date</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;">${fmtDate(inv.invoiceDate)}</div>
          </td>
        </tr>
        ${inv.purchaseOrderRef ? `
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Purchase Order</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;font-family:monospace;">${inv.purchaseOrderRef}</div>
          </td>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">PO Date</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;">${inv.poDate || '—'}</div>
          </td>
        </tr>` : ''}
        ${inv.uniqueId ? `
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Unique ID</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;font-family:monospace;">${inv.uniqueId}</div>
          </td>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Vendor Code</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;">${inv.vendorCode || '—'}</div>
          </td>
        </tr>` : ''}
      </table>
    </td></tr>

    <!-- Product Details -->
    <tr><td style="padding:16px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr><td colspan="2" style="background:#0f172a;padding:12px 20px;">
          <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;">Product Details</span>
        </td></tr>
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Product</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;">${item.description || '—'}</div>
          </td>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Brand</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;">${inv.brandName || '—'}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Quantity</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;">${item.qty ?? '—'} ${item.unit || ''}</div>
          </td>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Product Code</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;font-family:monospace;">${item.hsn || '—'}</div>
          </td>
        </tr>
        ${inv.grandTotal ? `
        <tr>
          <td colspan="2" style="padding:14px 20px;background:linear-gradient(135deg,#c0392b,#922b21);">
            <div style="font-size:11px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Grand Total</div>
            <div style="font-size:22px;font-weight:800;color:#fff;margin-top:2px;">${fmtAmt(inv.grandTotal)}</div>
          </td>
        </tr>` : ''}
      </table>
    </td></tr>

    <!-- Shipment Details -->
    ${(inv.orderStatus || inv.awb || inv.courierName || inv.dispatchDate || inv.deliveryDate) ? `
    <tr><td style="padding:16px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr><td colspan="2" style="background:#0f172a;padding:12px 20px;">
          <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;">Shipment Details</span>
        </td></tr>
        ${inv.orderStatus ? `
        <tr><td colspan="2" style="padding:12px 20px;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Order Status</div>
          <div style="display:inline-block;margin-top:4px;background:#dcfce7;color:#16a34a;font-size:12px;font-weight:700;padding:3px 12px;border-radius:20px;">${inv.orderStatus}</div>
        </td></tr>` : ''}
        ${(inv.awb || inv.courierName) ? `
        <tr>
          <td style="padding:12px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">AWB No.</div>
            <div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:3px;font-family:monospace;">${inv.awb || '—'}</div>
          </td>
          <td style="padding:12px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Courier</div>
            <div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:3px;">${inv.courierName || '—'}</div>
          </td>
        </tr>` : ''}
        ${(inv.dispatchDate || inv.deliveryDate) ? `
        <tr>
          <td style="padding:12px 20px;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Dispatch Date</div>
            <div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:3px;">${inv.dispatchDate || '—'}</div>
          </td>
          <td style="padding:12px 20px;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Expected Delivery</div>
            <div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:3px;">${inv.deliveryDate || '—'}</div>
          </td>
        </tr>` : ''}
      </table>
    </td></tr>` : ''}

    <!-- PDF Notice -->
    <tr><td style="padding:20px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">
        <tr><td style="padding:14px 18px;">
          <p style="margin:0;font-size:13px;color:#1e40af;font-weight:600;">
            📎 &nbsp;The invoice PDF (<strong>${pdfFilename}</strong>) is attached to this email.
          </p>
          <p style="margin:6px 0 0;font-size:12px;color:#3b82f6;">Please download and retain it for your records.</p>
        </td></tr>
      </table>
    </td></tr>

    <!-- Closing -->
    <tr><td style="padding:24px 40px;">
      <p style="margin:0;font-size:13px;color:#475569;line-height:1.7;">
        Kindly review the invoice and confirm receipt. For any queries, please reply to this email.
      </p>
      <p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">
        <strong>Payment Terms:</strong> ${inv.terms || 'Payment due within 30 days.'}
      </p>
      <p style="margin:20px 0 0;font-size:14px;color:#0f172a;font-weight:600;">Warm regards,</p>
      <p style="margin:4px 0 0;font-size:14px;font-weight:800;color:#c0392b;">Sri Chakra Industries</p>
      <p style="margin:2px 0 0;font-size:12px;color:#94a3b8;">ERP &amp; Operations Team</p>
    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#0f172a;padding:16px 40px;">
      <p style="margin:0;font-size:11px;color:#64748b;text-align:center;">
        This is a system-generated email from <strong style="color:#94a3b8;">Sri Chakra Industries ERP</strong>.
      </p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;

  const item0 = inv.items?.[0] || {};
  const textBody = [
    `Dear ${partyName},`,
    ``,
    `Greetings from Sri Chakra Industries!`,
    `Please find the invoice PDF (${pdfFilename}) attached to this email.`,
    ``,
    `Invoice No.  : ${inv.invoiceNo}`,
    `Date         : ${fmtDate(inv.invoiceDate)}`,
    inv.purchaseOrderRef ? `PO Number    : ${inv.purchaseOrderRef}` : null,
    inv.uniqueId         ? `Unique ID    : ${inv.uniqueId}` : null,
    ``,
    `Product      : ${item0.description || '—'}`,
    inv.brandName        ? `Brand        : ${inv.brandName}` : null,
    `Quantity     : ${item0.qty ?? '—'} ${item0.unit || ''}`,
    inv.grandTotal       ? `Grand Total  : ${fmtAmt(inv.grandTotal)}` : null,
    ``,
    inv.orderStatus      ? `Order Status : ${inv.orderStatus}` : null,
    inv.awb              ? `AWB No.      : ${inv.awb}` : null,
    inv.courierName      ? `Courier      : ${inv.courierName}` : null,
    ``,
    `Terms        : ${inv.terms || 'Payment due within 30 days.'}`,
    ``,
    `Warm regards,`,
    `Sri Chakra Industries — ERP & Operations Team`,
  ].filter(l => l !== null).join('\n');

  const info = await transporter.sendMail({
    from:        `"${fromName}" <${fromEmail}>`,
    to,
    subject:     `Invoice ${inv.invoiceNo} from Sri Chakra Industries — ${partyName}`,
    text:        textBody,
    html:        htmlBody,
    attachments: [{
      filename:    pdfFilename,
      content:     pdfBase64,
      encoding:    'base64',
      contentType: 'application/pdf',
    }],
  });

  return info;
};
