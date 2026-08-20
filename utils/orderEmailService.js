import { sendEmail } from './emailService.js';

/**
 * Send order confirmation email to dealer when admin approves their order.
 * Contains full order details with invoice-style breakdown.
 *
 * @param {Object} order - The SalesOrder document (populated with dealerId)
 * @param {Object} dealer - The Dealer document
 */
export const sendOrderApprovalEmail = async (order, dealer) => {
  const dealerEmail = dealer?.email;
  if (!dealerEmail) {
    console.log('[orderEmail] No email found for dealer, skipping email notification');
    return null;
  }

  const dealerName = dealer.businessName || dealer.name || 'Dealer';
  const orderItems = order.lineItems?.length ? order.lineItems : order.items || [];

  // Format currency
  const fmt = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  // Build items table rows
  const itemRows = orderItems.map((item, idx) => `
    <tr style="border-bottom: 1px solid #f0f0f0;">
      <td style="padding: 10px 8px; font-size: 13px; color: #374151;">${idx + 1}</td>
      <td style="padding: 10px 8px; font-size: 13px; color: #374151;">${item.name || item.itemName || '-'}</td>
      <td style="padding: 10px 8px; font-size: 13px; color: #374151; text-align: center;">${item.sku || '-'}</td>
      <td style="padding: 10px 8px; font-size: 13px; color: #374151; text-align: center;">${item.approvedQuantity || item.quantity || 0}</td>
      <td style="padding: 10px 8px; font-size: 13px; color: #374151; text-align: right;">${fmt(item.unitPrice || 0)}</td>
      <td style="padding: 10px 8px; font-size: 13px; color: #374151; text-align: center;">${item.gstPercent || 0}%</td>
      <td style="padding: 10px 8px; font-size: 13px; color: #374151; text-align: right; font-weight: 600;">${fmt(item.total || ((item.approvedQuantity || item.quantity || 0) * (item.unitPrice || 0)))}</td>
    </tr>
  `).join('');

  const subTotal = order.subTotal || orderItems.reduce((s, i) => s + ((i.approvedQuantity || i.quantity || 0) * (i.unitPrice || 0)), 0);
  const totalGst = order.totalGst || orderItems.reduce((s, i) => s + (i.gstAmount || 0), 0);
  const grandTotal = order.value || (subTotal + totalGst);

  const orderDate = order.orderDate || order.createdAt;
  const formattedDate = orderDate ? new Date(orderDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #C8102E, #E8374A); padding: 28px 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700;">Sri Chakra Industries</h1>
              <p style="margin: 6px 0 0; color: rgba(255,255,255,0.85); font-size: 13px;">Order Approved & Confirmed</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              
              <!-- Greeting -->
              <p style="font-size: 15px; color: #1a1a1a; margin: 0 0 8px;">Dear <strong>${dealerName}</strong>,</p>
              <p style="font-size: 14px; color: #374151; margin: 0 0 24px; line-height: 1.6;">
                Your order <strong style="color: #C8102E;">${order.orderId}</strong> has been <strong style="color: #16A34A;">approved</strong> and is now being processed. Below are your order details:
              </p>

              <!-- Order Info Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #FFF5F6; border: 1px solid #fecdd3; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size: 12px; color: #6B7280; padding-bottom: 4px;">Order ID</td>
                        <td style="font-size: 12px; color: #6B7280; padding-bottom: 4px;">Order Date</td>
                        <td style="font-size: 12px; color: #6B7280; padding-bottom: 4px;">Status</td>
                      </tr>
                      <tr>
                        <td style="font-size: 14px; color: #1a1a1a; font-weight: 700;">${order.orderId}</td>
                        <td style="font-size: 14px; color: #1a1a1a; font-weight: 600;">${formattedDate}</td>
                        <td><span style="background-color: #DCFCE7; color: #16A34A; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 12px;">APPROVED</span></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Items Table -->
              <h3 style="font-size: 14px; color: #1a1a1a; margin: 0 0 12px; font-weight: 700;">Order Items</h3>
              <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
                <thead>
                  <tr style="background-color: #f9fafb;">
                    <th style="padding: 10px 8px; font-size: 11px; color: #6B7280; text-align: left; font-weight: 600; text-transform: uppercase;">#</th>
                    <th style="padding: 10px 8px; font-size: 11px; color: #6B7280; text-align: left; font-weight: 600; text-transform: uppercase;">Product</th>
                    <th style="padding: 10px 8px; font-size: 11px; color: #6B7280; text-align: center; font-weight: 600; text-transform: uppercase;">SKU</th>
                    <th style="padding: 10px 8px; font-size: 11px; color: #6B7280; text-align: center; font-weight: 600; text-transform: uppercase;">Qty</th>
                    <th style="padding: 10px 8px; font-size: 11px; color: #6B7280; text-align: right; font-weight: 600; text-transform: uppercase;">Rate</th>
                    <th style="padding: 10px 8px; font-size: 11px; color: #6B7280; text-align: center; font-weight: 600; text-transform: uppercase;">GST</th>
                    <th style="padding: 10px 8px; font-size: 11px; color: #6B7280; text-align: right; font-weight: 600; text-transform: uppercase;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
              </table>

              <!-- Totals -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td width="60%"></td>
                  <td width="40%">
                    <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                      <tr style="border-bottom: 1px solid #f0f0f0;">
                        <td style="padding: 10px 14px; font-size: 13px; color: #6B7280;">Sub Total</td>
                        <td style="padding: 10px 14px; font-size: 13px; color: #1a1a1a; text-align: right; font-weight: 600;">${fmt(subTotal)}</td>
                      </tr>
                      <tr style="border-bottom: 1px solid #f0f0f0;">
                        <td style="padding: 10px 14px; font-size: 13px; color: #6B7280;">GST</td>
                        <td style="padding: 10px 14px; font-size: 13px; color: #1a1a1a; text-align: right; font-weight: 600;">${fmt(totalGst)}</td>
                      </tr>
                      <tr style="background-color: #FFF5F6;">
                        <td style="padding: 12px 14px; font-size: 14px; color: #C8102E; font-weight: 700;">Grand Total</td>
                        <td style="padding: 12px 14px; font-size: 14px; color: #C8102E; text-align: right; font-weight: 700;">${fmt(grandTotal)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Footer note -->
              <p style="font-size: 13px; color: #6B7280; margin: 0 0 8px; line-height: 1.6;">
                Your order is now being processed. You will receive updates as it moves through picking, packing, and dispatch.
              </p>
              <p style="font-size: 13px; color: #6B7280; margin: 0; line-height: 1.6;">
                Thank you for your business!
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 20px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 12px; color: #9CA3AF;">Sri Chakra Industries | Order Confirmation</p>
              <p style="margin: 4px 0 0; font-size: 11px; color: #D1D5DB;">This is an automated email. Please do not reply.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const subject = `Order ${order.orderId} Approved — Sri Chakra Industries`;
  const text = `Dear ${dealerName},\n\nYour order ${order.orderId} has been approved.\n\nOrder Total: ${fmt(grandTotal)}\nItems: ${orderItems.length}\n\nThank you,\nSri Chakra Industries`;

  try {
    const info = await sendEmail({ to: dealerEmail, subject, text, html });
    console.log(`[orderEmail] ✅ Order approval email sent to ${dealerEmail} for order ${order.orderId}`);
    return info;
  } catch (error) {
    // Don't fail the approval if email fails — just log the error
    console.error(`[orderEmail] ❌ Failed to send approval email to ${dealerEmail}:`, error.message);
    return null;
  }
};
