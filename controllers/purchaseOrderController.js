import PurchaseOrder from '../models/PurchaseOrder.js';
import XLSX from 'xlsx';
import { logActivity } from '../utils/activityLogger.js';
import nodemailer from 'nodemailer';

// Generate PO ID
const generatePOId = async () => {
  const year = new Date().getFullYear();
  const lastPO = await PurchaseOrder.findOne({ poId: new RegExp(`^PO-${year}-`) })
    .sort({ poId: -1 })
    .limit(1);
  
  if (!lastPO) return `PO-${year}-001`;
  
  const lastNum = parseInt(lastPO.poId.split('-')[2]);
  const newNum = String(lastNum + 1).padStart(3, '0');
  return `PO-${year}-${newNum}`;
};

// Get all POs
export const getAllPOs = async (req, res) => {
  try {
    const { status, vendor } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (vendor) filter.vendor = vendor;

    const pos = await PurchaseOrder.find(filter)
      .populate('vendor')
      .populate('linkedRFQ', 'rfqId title')
      .populate('sentHistory.sentBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: pos });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get PO by ID
export const getPOById = async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id)
      .populate('vendor')
      .populate('linkedRFQ')
      .populate('sentHistory.sentBy', 'name email');

    if (!po) {
      return res.status(404).json({ success: false, message: 'PO not found' });
    }
    
    res.json({ success: true, data: po });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create PO
export const createPO = async (req, res) => {
  try {
    // Validate vendor exists
    const Vendor = (await import('../models/Vendor.js')).default;
    const vendor = await Vendor.findById(req.body.vendor);
    if (!vendor) {
      return res.status(400).json({ success: false, message: 'Vendor not found' });
    }
    if (vendor.status === 'Blacklisted') {
      return res.status(400).json({ success: false, message: 'Cannot create PO for blacklisted vendor' });
    }

    // If linked to an RFQ, validate the RFQ's linked PR is approved
    if (req.body.linkedRFQ) {
      const RFQ = (await import('../models/RFQ.js')).default;
      const rfq = await RFQ.findById(req.body.linkedRFQ).populate('linkedPR');
      if (!rfq) {
        return res.status(400).json({ success: false, message: 'Linked RFQ not found' });
      }
      if (rfq.linkedPR && rfq.linkedPR.status !== 'Approved') {
        return res.status(400).json({
          success: false,
          message: `Cannot create PO: PR ${rfq.linkedPR.prId} linked to this RFQ is not approved (status: ${rfq.linkedPR.status}). Please approve the PR first.`,
        });
      }
    }

    const poId = await generatePOId();
    
    // Calculate totals
    const items = req.body.items.map(item => ({
      ...item,
      total: item.qty * item.basePrice * (1 + item.gst / 100)
    }));
    
    const subtotal = items.reduce((sum, item) => sum + (item.qty * item.basePrice), 0);
    const gstTotal = items.reduce((sum, item) => sum + (item.qty * item.basePrice * item.gst / 100), 0);
    const grandTotal = subtotal + gstTotal;
    
    const po = new PurchaseOrder({
      ...req.body,
      poId,
      items,
      subtotal,
      gstTotal,
      grandTotal
    });
    
    await po.save();
    if (req.user) {
      await logActivity(req, req.user, 'CREATE_PO', {
        module: 'procurement',
        description: `Created PO ${po.poId} for vendor ${vendor.companyName}`,
        targetId: po._id.toString(),
        targetType: 'PurchaseOrder'
      });
    }
    await po.populate('vendor', 'companyName');
    
    res.status(201).json({ success: true, data: po });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Bulk Upload POs
export const bulkUploadPOs = async (req, res) => {
  try {
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Excel sheet is empty' });
    }

    const Vendor = (await import('../models/Vendor.js')).default;
    const successful = [];
    const errors = [];

    // Group rows by vendor to create POs with multiple items
    const vendorGroups = {};
    rows.forEach((row, index) => {
      // Normalize keys
      const normalizedRow = {};
      Object.entries(row).forEach(([k, v]) => {
        normalizedRow[k.toLowerCase().replace(/\s+/g, '_')] = v;
      });

      const vendorKey = normalizedRow.vendor?.toString().toLowerCase().trim();
      if (!vendorKey) {
        errors.push({ row: index + 1, message: 'Vendor is required' });
        return;
      }

      if (!vendorGroups[vendorKey]) {
        vendorGroups[vendorKey] = {
          vendorName: normalizedRow.vendor,
          items: [],
          deliveryDate: normalizedRow.delivery_date
        };
      }
      vendorGroups[vendorKey].items.push({
        name: normalizedRow.item_name,
        qty: Number(normalizedRow.qty) || 0,
        unit: normalizedRow.unit || 'Nos',
        basePrice: Number(normalizedRow.base_price) || 0,
        gst: Number(normalizedRow.gst) || 0
      });
    });

    // Process each vendor group to create a PO
    for (const [vendorKey, group] of Object.entries(vendorGroups)) {
      try {
        // Find vendor by name or companyName
        let vendor = await Vendor.findOne({
          $or: [
            { name: { $regex: new RegExp(`^${group.vendorName}$`, 'i') } },
            { companyName: { $regex: new RegExp(`^${group.vendorName}$`, 'i') } }
          ]
        });

        if (!vendor) {
          errors.push({ row: vendorKey, message: `Vendor "${group.vendorName}" not found` });
          continue;
        }

        if (vendor.status === 'Blacklisted') {
          errors.push({ row: vendorKey, message: `Cannot create PO for blacklisted vendor "${group.vendorName}"` });
          continue;
        }

        // Validate items
        const validItems = group.items.filter(item => {
          if (!item.name || item.qty <= 0 || item.basePrice <= 0) {
            errors.push({ row: vendorKey, message: `Invalid item: ${item.name || 'unnamed'} - check qty and base price` });
            return false;
          }
          return true;
        });

        if (validItems.length === 0) continue;

        const poId = await generatePOId();
        const items = validItems.map(item => ({
          ...item,
          total: item.qty * item.basePrice * (1 + item.gst / 100)
        }));
        const subtotal = items.reduce((sum, item) => sum + (item.qty * item.basePrice), 0);
        const gstTotal = items.reduce((sum, item) => sum + (item.qty * item.basePrice * item.gst / 100), 0);
        const grandTotal = subtotal + gstTotal;

        const po = new PurchaseOrder({
          poId,
          vendor: vendor._id,
          items,
          subtotal,
          gstTotal,
          grandTotal,
          deliveryDate: group.deliveryDate,
          status: 'Draft'
        });

        await po.save();
        await po.populate('vendor', 'companyName');
        successful.push(po);
      } catch (error) {
        errors.push({ row: vendorKey, message: error.message });
      }
    }

    res.status(201).json({
      success: true,
      data: {
        successful: successful.length,
        failed: errors.length,
        errors
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update PO
export const updatePO = async (req, res) => {
  try {
    // Recalculate totals if items changed
    if (req.body.items) {
      const items = req.body.items.map(item => ({
        ...item,
        total: item.qty * item.basePrice * (1 + item.gst / 100)
      }));
      
      req.body.subtotal = items.reduce((sum, item) => sum + (item.qty * item.basePrice), 0);
      req.body.gstTotal = items.reduce((sum, item) => sum + (item.qty * item.basePrice * item.gst / 100), 0);
      req.body.grandTotal = req.body.subtotal + req.body.gstTotal;
      req.body.items = items;
    }
    
    const po = await PurchaseOrder.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('vendor', 'companyName');
    
    if (!po) {
      return res.status(404).json({ success: false, message: 'PO not found' });
    }

    res.json({ success: true, data: po });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Update PO status
export const updatePOStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    const po = await PurchaseOrder.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).populate('vendor', 'companyName');
    
    if (!po) {
      return res.status(404).json({ success: false, message: 'PO not found' });
    }
    if (req.user) {
      await logActivity(req, req.user, 'UPDATE_PO_STATUS', {
        module: 'procurement',
        description: `PO ${po.poId} status changed to ${po.status}`,
        targetId: po._id.toString(),
        targetType: 'PurchaseOrder'
      });
    }
    res.json({ success: true, data: po });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Delete PO
export const deletePO = async (req, res) => {
  try {
    const po = await PurchaseOrder.findByIdAndDelete(req.params.id);
    
    if (!po) {
      return res.status(404).json({ success: false, message: 'PO not found' });
    }

    res.json({ success: true, message: 'PO deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Send PO via Email
export const sendPOEmail = async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id).populate('vendor');
    if (!po) {
      return res.status(404).json({ success: false, message: 'PO not found' });
    }

    const { to } = req.body;
    const recipientEmail = to || po.vendor.email;

    if (!recipientEmail) {
      return res.status(400).json({ success: false, message: 'No email recipient provided' });
    }

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_USER || !SMTP_PASS) {
      return res.status(500).json({ success: false, message: 'Email service not configured' });
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(SMTP_PORT || '587'),
      secure: parseInt(SMTP_PORT || '587') === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const fromName = process.env.SMTP_FROM_NAME || 'Sri Chakra Industries';
    const fromEmail = SMTP_USER;

    const fmtDate = (d) => {
      try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
      catch { return d || ''; }
    };
    const fmtAmt = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;

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
              <div style="font-size:11px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:1px;font-weight:600;">Purchase Order</div>
              <div style="font-size:20px;font-weight:800;color:#fff;margin-top:2px;">${po.poId}</div>
              <div style="font-size:12px;color:rgba(255,255,255,0.75);margin-top:2px;">${fmtDate(po.createdAt)}</div>
            </div>
          </td>
        </tr></table>
      </td>
    </tr>

    <!-- Greeting -->
    <tr><td style="padding:32px 40px 0;">
      <p style="margin:0;font-size:16px;font-weight:600;color:#0f172a;">Dear ${po.vendor.companyName || 'Vendor'},</p>
      <p style="margin:12px 0 0;font-size:14px;color:#475569;line-height:1.7;">
        Greetings from <strong>Sri Chakra Industries</strong>! Please find the purchase order details below.
      </p>
    </td></tr>

    <!-- PO Details -->
    <tr><td style="padding:24px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr><td colspan="2" style="background:#0f172a;padding:12px 20px;">
          <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;">Purchase Order Details</span>
        </td></tr>
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;width:50%;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">PO Number</div>
            <div style="font-size:14px;font-weight:700;color:#c0392b;margin-top:3px;font-family:monospace;">${po.poId}</div>
          </td>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Date</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;">${fmtDate(po.createdAt)}</div>
          </td>
        </tr>
        ${po.deliveryDate ? `
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Delivery Date</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;">${fmtDate(po.deliveryDate)}</div>
          </td>
          <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Status</div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:3px;">${po.status}</div>
          </td>
        </tr>` : ''}
      </table>
    </td></tr>

    <!-- Items -->
    <tr><td style="padding:16px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr><td colspan="5" style="background:#0f172a;padding:12px 20px;">
          <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;">Items</span>
        </td></tr>
        <tr style="background:#e2e8f0;">
          <th style="padding:10px 14px;font-size:11px;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">Item</th>
          <th style="padding:10px 14px;font-size:11px;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Qty</th>
          <th style="padding:10px 14px;font-size:11px;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Unit Price</th>
          <th style="padding:10px 14px;font-size:11px;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">GST</th>
          <th style="padding:10px 14px;font-size:11px;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Total</th>
        </tr>
        ${po.items.map(item => `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#0f172a;">${item.name}</td>
          <td style="padding:10px 14px;font-size:13px;color:#0f172a;text-align:right;">${item.qty} ${item.unit}</td>
          <td style="padding:10px 14px;font-size:13px;color:#0f172a;text-align:right;">${fmtAmt(item.basePrice)}</td>
          <td style="padding:10px 14px;font-size:13px;color:#0f172a;text-align:right;">${item.gst}%</td>
          <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#0f172a;text-align:right;">${fmtAmt(item.total)}</td>
        </tr>`).join('')}
        <tr style="background:#e2e8f0;">
          <td colspan="4" style="padding:10px 14px;text-align:right;font-size:13px;font-weight:600;color:#0f172a;">Subtotal:</td>
          <td style="padding:10px 14px;text-align:right;font-size:13px;font-weight:700;color:#0f172a;">${fmtAmt(po.subtotal)}</td>
        </tr>
        <tr style="background:#e2e8f0;">
          <td colspan="4" style="padding:10px 14px;text-align:right;font-size:13px;font-weight:600;color:#0f172a;">GST Total:</td>
          <td style="padding:10px 14px;text-align:right;font-size:13px;font-weight:700;color:#0f172a;">${fmtAmt(po.gstTotal)}</td>
        </tr>
        <tr style="background:linear-gradient(135deg,#c0392b,#922b21);">
          <td colspan="4" style="padding:12px 14px;text-align:right;font-size:13px;font-weight:700;color:#fff;">Grand Total:</td>
          <td style="padding:12px 14px;text-align:right;font-size:15px;font-weight:900;color:#fff;">${fmtAmt(po.grandTotal)}</td>
        </tr>
      </table>
    </td></tr>

    <!-- Closing -->
    <tr><td style="padding:24px 40px;">
      <p style="margin:0;font-size:13px;color:#475569;line-height:1.7;">
        Kindly acknowledge receipt of this purchase order and confirm the delivery date. For any queries, please reply to this email.
      </p>
      ${po.remarks ? `<p style="margin:8px 0 0;font-size:12px;color:#94a3b8;"><strong>Remarks:</strong> ${po.remarks}</p>` : ''}
      <p style="margin:20px 0 0;font-size:14px;color:#0f172a;font-weight:600;">Warm regards,</p>
      <p style="margin:4px 0 0;font-size:14px;font-weight:800;color:#c0392b;">Sri Chakra Industries</p>
      <p style="margin:2px 0 0;font-size:12px;color:#94a3b8;">Procurement Team</p>
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

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: recipientEmail,
      subject: `Purchase Order ${po.poId} from Sri Chakra Industries`,
      html: htmlBody,
    });

    // Record in sent history
    po.sentHistory.push({
      sentAt: new Date(),
      sentBy: req.user?._id,
      method: 'email',
      recipient: recipientEmail
    });
    await po.save();

    res.json({ success: true, message: 'PO sent via email successfully' });
  } catch (error) {
    console.error('Error sending PO email:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Send PO via WhatsApp (placeholder - you can integrate with WhatsApp API like Twilio, Wati, etc.)
export const sendPOWhatsApp = async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id).populate('vendor');
    if (!po) {
      return res.status(404).json({ success: false, message: 'PO not found' });
    }

    const { to } = req.body;
    const recipientPhone = to || po.vendor.phone;

    if (!recipientPhone) {
      return res.status(400).json({ success: false, message: 'No phone number provided' });
    }

    const fmtDate = (d) => {
      try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
      catch { return d || ''; }
    };
    const fmtAmt = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;

    const message = `
*Sri Chakra Industries - Purchase Order*

PO Number: ${po.poId}
Date: ${fmtDate(po.createdAt)}
Vendor: ${po.vendor.companyName}
Status: ${po.status}
${po.deliveryDate ? `Delivery Date: ${fmtDate(po.deliveryDate)}` : ''}

*Items:*
${po.items.map((item, i) => `${i + 1}. ${item.name} - ${item.qty} ${item.unit} @ ${fmtAmt(item.basePrice)} (${item.gst}% GST) = ${fmtAmt(item.total)}`).join('\n')}

*Summary:*
Subtotal: ${fmtAmt(po.subtotal)}
GST Total: ${fmtAmt(po.gstTotal)}
Grand Total: ${fmtAmt(po.grandTotal)}

${po.remarks ? `Remarks: ${po.remarks}` : ''}

Please acknowledge receipt of this PO.
`;

    // TODO: Integrate with WhatsApp API here (Twilio, Wati, etc.)
    // For now, we'll just record it in sent history and return a success message
    console.log('WhatsApp message to send:', message);

    // Record in sent history
    po.sentHistory.push({
      sentAt: new Date(),
      sentBy: req.user?._id,
      method: 'whatsapp',
      recipient: recipientPhone
    });
    await po.save();

    res.json({ success: true, message: 'PO sent via WhatsApp successfully (placeholder - integrate with actual WhatsApp API)', data: { message } });
  } catch (error) {
    console.error('Error sending PO WhatsApp:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
