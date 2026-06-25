import Vendor from '../models/Vendor.js';
import VendorPrice from '../models/VendorPrice.js';
import BOM from '../models/BOM.js';
import { sendEmail, verifyTransporter, classifySMTPError } from '../utils/emailService.js';

// ── Auto-generate vendor ID ───────────────────────────────────────────────────
const generateVendorId = async () => {
  const last = await Vendor.findOne({}, {}, { sort: { createdAt: -1 } });
  if (!last) return 'V-001';
  const num = parseInt((last.vendorId || '').split('-')[1] || '0') + 1;
  return `V-${String(num).padStart(3, '0')}`;
};

// ── GET /api/vendors/test-email ───────────────────────────────────────────────
// Diagnostic route — verifies SMTP config without sending a real email
export const testEmailConfig = async (req, res) => {
  try {
    await verifyTransporter();
    const user = (process.env.EMAIL_USERNAME || process.env.SMTP_USER || '').trim();
    res.json({
      success: true,
      message: `✅ SMTP connection verified. Ready to send emails from ${user}`,
    });
  } catch (err) {
    console.error('[testEmailConfig]', err.message);
    const { userMessage, code } = classifySMTPError(err);
    res.status(500).json({
      success: false,
      message: userMessage,
      code: err.code || code,
      fix: 'Update EMAIL_PASSWORD in backend .env with a valid Gmail App Password, then restart the server.',
      appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    });
  }
};

// ── POST /api/vendors/send-email ──────────────────────────────────────────────
export const sendVendorEmail = async (req, res) => {
  try {
    const { vendorId, itemName, itemCode, qty, unit, bomProduct, bomId, componentId } = req.body;

    if (!vendorId) return res.status(400).json({ success: false, message: 'vendorId is required' });
    if (!itemName) return res.status(400).json({ success: false, message: 'itemName is required' });

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    if (!vendor.email)
      return res.status(400).json({ success: false, message: `Vendor "${vendor.companyName}" has no email address on record` });

    const subject = `Quotation Request for Material Supply | Sri Chakra Industries`;
    const qtyUnit = `${qty || '—'} ${unit || 'Nos'}`;

    // ── Plain text ────────────────────────────────────────────────────────────
    const text = `Dear Sir/Madam,

Greetings from Sri Chakra Industries.

We request you to provide your quotation for the following material requirement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BOM Name : ${bomProduct || '—'}

Material Details
  Item Name    : ${itemName}
  Item Code    : ${itemCode || '—'}
  Required Qty : ${qtyUnit}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please provide the following information:
  ✓ Unit Price
  ✓ GST Details
  ✓ Delivery Timeline
  ✓ Payment Terms
  ✓ Material Availability

Kindly share your quotation at the earliest.

Thank you for your support.

Regards,
Procurement Department
Sri Chakra Industries
Bangalore

This is a system-generated email.`;

    // ── HTML ──────────────────────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.09);">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#c0392b,#922b21);padding:26px 36px 22px;">
      <div style="font-size:22px;font-weight:800;color:#fff;">Sri Chakra Industries</div>
      <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.72);letter-spacing:3px;text-transform:uppercase;margin-top:5px;">Quotation Request for Material Supply</div>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:28px 36px 0;">
      <p style="margin:0;font-size:14px;color:#1e293b;">Dear Sir/Madam,</p>
      <p style="margin:12px 0 0;font-size:14px;color:#475569;line-height:1.75;">
        Greetings from <strong>Sri Chakra Industries</strong>.<br/>
        We request you to provide your quotation for the following material requirement.
      </p>
    </td>
  </tr>

  <!-- Divider -->
  <tr><td style="padding:18px 36px 0;">
    <div style="border-top:2px solid #e2e8f0;"></div>
  </td></tr>

  <!-- BOM Name -->
  <tr>
    <td style="padding:14px 36px 0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:13px;color:#64748b;width:38%;padding:3px 0;font-weight:600;">BOM Name</td>
          <td style="font-size:13px;color:#1e293b;font-weight:700;padding:3px 0;">:&nbsp;&nbsp;${bomProduct || '—'}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Material Details -->
  <tr>
    <td style="padding:14px 36px 0;">
      <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:0.8px;">Material Details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <tr style="background:#fafafa;">
          <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;width:40%;border-bottom:1px solid #e2e8f0;">Item Name</td>
          <td style="padding:10px 16px;font-size:13px;color:#c0392b;font-weight:700;border-bottom:1px solid #e2e8f0;">${itemName}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Item Code</td>
          <td style="padding:10px 16px;font-size:13px;color:#1e293b;font-weight:600;font-family:monospace;border-bottom:1px solid #e2e8f0;">${itemCode || '—'}</td>
        </tr>
        <tr style="background:#fafafa;">
          <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;">Required Qty</td>
          <td style="padding:10px 16px;font-size:13px;color:#1e293b;font-weight:700;">${qtyUnit}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Divider -->
  <tr><td style="padding:16px 36px 0;">
    <div style="border-top:2px solid #e2e8f0;"></div>
  </td></tr>

  <!-- Please Provide -->
  <tr>
    <td style="padding:14px 36px 0;">
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1e293b;">Please provide the following information:</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${['Unit Price','GST Details','Delivery Timeline','Payment Terms','Material Availability']
          .map(itm => `<tr><td style="padding:5px 0;font-size:13px;color:#475569;">
            <span style="color:#16a34a;font-weight:700;">&#10003;</span>&nbsp;&nbsp;${itm}
          </td></tr>`).join('')}
      </table>
    </td>
  </tr>

  <!-- CTA -->
  <tr>
    <td style="padding:18px 36px 0;">
      <p style="margin:0;font-size:13px;color:#1e293b;font-weight:700;">Kindly share your quotation at the earliest.</p>
      <p style="margin:6px 0 0;font-size:13px;color:#475569;">Thank you for your support.</p>
    </td>
  </tr>

  <!-- Closing -->
  <tr>
    <td style="padding:20px 36px 28px;">
      <p style="margin:0;font-size:13px;color:#475569;">Regards,</p>
      <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#1e293b;">Procurement Department</p>
      <p style="margin:2px 0 0;font-size:15px;font-weight:800;color:#c0392b;">Sri Chakra Industries</p>
      <p style="margin:2px 0 0;font-size:12px;color:#64748b;">Bangalore</p>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#0f172a;padding:12px 36px;">
      <p style="margin:0;font-size:11px;color:#64748b;text-align:center;">
        This is a system-generated email from <strong style="color:#94a3b8;">Sri Chakra Industries ERP</strong>.
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

    const info = await sendEmail({ to: vendor.email, subject, text, html });

    // ── Persist rfqStatus = 'Sent' on the BOM component ─────────────────────
    if (bomId && componentId) {
      try {
        await BOM.updateOne(
          { _id: bomId, 'components._id': componentId },
          {
            $set: {
              'components.$.rfqStatus': 'Sent',
              'components.$.rfqSentAt': new Date(),
            },
          }
        );
      } catch (dbErr) {
        console.warn('[sendVendorEmail] Could not update rfqStatus in BOM:', dbErr.message);
      }
    }

    res.json({
      success: true,
      message: `Email sent successfully to ${vendor.companyName} (${vendor.email})`,
      sentTo: vendor.email,
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[sendVendorEmail] Error:', error.message);
    console.error('[sendVendorEmail] Code:', error.code);

    const { userMessage, code } = classifySMTPError(error);

    // Use 503 for credential/config issues so the frontend can show a better message
    const statusCode =
      code === 'INVALID_APP_PASSWORD' || code === 'MISSING_CREDENTIALS' || code === 'INVALID_CREDENTIALS'
        ? 503
        : 500;

    res.status(statusCode).json({
      success: false,
      message: userMessage,
      code: code,
      ...(statusCode === 503 && {
        fix: 'Generate a new Gmail App Password at https://myaccount.google.com/apppasswords and update EMAIL_PASSWORD in backend .env, then restart the server.',
      }),
    });
  }
};

// ── POST /api/vendors ─────────────────────────────────────────────────────────
export const createVendor = async (req, res) => {
  try {
    const vendorId = await generateVendorId();
    const vendor = await Vendor.create({ ...req.body, vendorId });
    res.status(201).json({ success: true, data: vendor });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || 'Failed to create vendor' });
  }
};

// ── GET /api/vendors ──────────────────────────────────────────────────────────
export const getAllVendors = async (req, res) => {
  try {
    const { search, category, status, page, limit } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (status)   filter.status   = status;
    if (search) {
      filter.$or = [
        { companyName:    { $regex: search, $options: 'i' } },
        { vendorId:       { $regex: search, $options: 'i' } },
        { contactPerson:  { $regex: search, $options: 'i' } },
        { city:           { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum  = parseInt(page)  || 0;
    const limitNum = parseInt(limit) || 0;
    const usePagination = pageNum > 0 && limitNum > 0;
    const skip = usePagination ? (pageNum - 1) * limitNum : 0;

    const [vendors, totalCount] = await Promise.all([
      Vendor.find(filter)
        .sort({ createdAt: -1 })
        .skip(usePagination ? skip : 0)
        .limit(usePagination ? limitNum : 0),
      usePagination ? Vendor.countDocuments(filter) : Promise.resolve(null),
    ]);

    const response = { success: true, data: vendors };
    if (usePagination) {
      response.pagination = {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
      };
    }
    res.json(response);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/vendors/stats ────────────────────────────────────────────────────
export const getVendorStats = async (req, res) => {
  try {
    const [total, active, inactive, blacklisted] = await Promise.all([
      Vendor.countDocuments(),
      Vendor.countDocuments({ status: 'Active' }),
      Vendor.countDocuments({ status: 'Inactive' }),
      Vendor.countDocuments({ status: 'Blacklisted' }),
    ]);
    res.json({ success: true, data: { total, active, inactive, blacklisted } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/vendors/status/:status ──────────────────────────────────────────
export const getVendorsByStatus = async (req, res) => {
  try {
    const vendors = await Vendor.find({ status: req.params.status });
    res.json({ success: true, data: vendors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/vendors/:id ──────────────────────────────────────────────────────
export const getVendorById = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, data: vendor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/vendors/:id ──────────────────────────────────────────────────────
export const updateVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, data: vendor });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || 'Failed to update vendor' });
  }
};

// ── DELETE /api/vendors/:id ───────────────────────────────────────────────────
export const deleteVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndDelete(req.params.id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, message: 'Vendor deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// Vendor Price Mapping
// ══════════════════════════════════════════════════════════════════════════════

export const getVendorPrices = async (req, res) => {
  try {
    const prices = await VendorPrice.find({ vendor: req.params.id }).sort({ productName: 1 });
    res.json({ success: true, data: prices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addVendorPrice = async (req, res) => {
  try {
    const price = await VendorPrice.create({ ...req.body, vendor: req.params.id });
    res.status(201).json({ success: true, data: price });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateVendorPrice = async (req, res) => {
  try {
    const price = await VendorPrice.findByIdAndUpdate(req.params.priceId, req.body, { new: true, runValidators: true });
    if (!price) return res.status(404).json({ success: false, message: 'Price entry not found' });
    res.json({ success: true, data: price });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteVendorPrice = async (req, res) => {
  try {
    const price = await VendorPrice.findByIdAndDelete(req.params.priceId);
    if (!price) return res.status(404).json({ success: false, message: 'Price entry not found' });
    res.json({ success: true, message: 'Price entry deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getPricesByProduct = async (req, res) => {
  try {
    const { productCode, productName } = req.query;
    const filter = {};
    if (productCode) filter.productCode = productCode;
    if (productName) filter.productName = { $regex: productName, $options: 'i' };
    const prices = await VendorPrice.find(filter)
      .populate('vendor', 'companyName vendorId rating')
      .sort({ unitPrice: 1 });
    res.json({ success: true, data: prices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
