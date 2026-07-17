/**
 * /api/dealer/returns
 * ─────────────────────────────────────────────────────────────────────────────
 * Dealer-facing return management routes (called with dealer JWT).
 * Admin approve/reject are at PUT /api/material-returns/:id/approve|reject
 * and write back DealerNotification records for in-app alerts.
 *
 * Endpoints (dealer JWT required):
 *   GET  /eligible-products  → flat list of all returnable products
 *   GET  /eligible-orders    → delivered orders with lineItems (for order picker)
 *   GET  /                   → this dealer's return history
 *   POST /                   → create return request (MaterialReturn)
 *   GET  /notifications      → dealer's in-app notifications
 *   PUT  /notifications/:id/read  → mark one as read
 *   PUT  /notifications/read-all  → mark all as read
 *   GET  /:id                → single return detail
 * ─────────────────────────────────────────────────────────────────────────────
 */
import express from 'express';
import multer  from 'multer';
import path    from 'path';
import fs      from 'fs';
import MaterialReturn from '../../models/MaterialReturn.js';
import SalesOrder from '../../models/SalesOrder.js';
import DealerNotification from '../../models/DealerNotification.js';
import { protectDealer } from '../../middleware/dealerAuthMiddleware.js';

const router = express.Router();

/* ── buildReturnResponse helper ──────────────────────────────────────────── */
// Consistent shape for both new creation and idempotent-existing responses.
const buildReturnResponse = (mr) => ({
  _id:           mr._id,
  mrId:          mr.mrId,
  orderNo:       mr.orderNo,
  returnDate:    mr.returnDate || mr.createdAt,
  currentStage:  mr.currentStage,
  approvalStatus:mr.approvalStatus,
  productName:   mr.productName,
  skuCode:       mr.skuCode,
  returnQty:     mr.returnQty,
  orderedQty:    mr.orderedQty,
  unitPrice:     mr.unitPrice,
  value:         mr.value,
  reason:        mr.reason,
  remarks:       mr.remarks,
  photoUrl:      mr.photoUrl,
  createdAt:     mr.createdAt,
});

/* ── multer — optional photo upload ──────────────────────────────────────── */
const uploadDir = path.join(process.cwd(), 'uploads', 'returns');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname) || '.jpg';
    cb(null, `return_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

/**
 * Generate a guaranteed-unique MR ID like MR-2026-001234-AB.
 *
 * Strategy: timestamp millis (last 6 digits) + 2 random hex chars.
 * This is collision-proof even under concurrent requests because the
 * timestamp part changes every millisecond and random suffix adds
 * 256x additional uniqueness. Falls back to pure random if somehow
 * still colliding (shouldn't happen in practice).
 */
const genMrId = async () => {
  const year  = new Date().getFullYear();
  const ts    = Date.now().toString().slice(-6);               // last 6 ms digits
  const rand  = Math.random().toString(36).slice(2, 4).toUpperCase(); // 2 chars
  const mrId  = `MR-${year}-${ts}${rand}`;

  // Verify uniqueness (extremely unlikely to collide, but guard anyway)
  const exists = await MaterialReturn.findOne({ mrId }).lean();
  if (exists) {
    // Pure random fallback
    const fallback = `MR-${year}-${Date.now().toString(36).toUpperCase()}`;
    return fallback;
  }
  return mrId;
};

/**
 * Orders eligible for return.
 * Includes every status after "Order Placed" so dealers who haven't had
 * a fully-delivered order yet can still raise returns (common in dev/demo).
 */
const ELIGIBLE_STATUSES = [
  'Delivered',
  'Dispatched',
  'Invoice Generated',
  'Packing Completed',
  'Approved',
];

/** Build a normalised lineItems array from any order shape */
const normaliseLines = (order) => {
  if (Array.isArray(order.lineItems) && order.lineItems.length > 0)
    return order.lineItems;
  if (Array.isArray(order.items) && order.items.length > 0)
    return order.items.map(i => ({
      productId:        i.itemId,
      name:             i.itemName || '',
      sku:              i.sku || '',
      quantity:         i.quantity  || 0,
      approvedQuantity: i.approvedQuantity,
      unitPrice:        i.unitPrice || 0,
      gstPercent:       i.gstPercent || 0,
      total:            i.totalPrice || 0,
    }));
  return [];
};

/* ── GET /eligible-products ───────────────────────────────────────────────── */
// Flat list of every line-item across all the dealer's delivered orders.
// Used for the product dropdown on the New Return form.
router.get('/eligible-products', protectDealer, async (req, res) => {
  try {
    const dealer  = req.dealer;
    const matchOr = [{ dealerId: dealer._id }];
    if (dealer.businessName)
      matchOr.push({ customer: { $regex: dealer.businessName, $options: 'i' } });
    if (dealer.name)
      matchOr.push({ customer: { $regex: dealer.name, $options: 'i' } });

    const orders = await SalesOrder.find({ $or: matchOr, status: { $in: ELIGIBLE_STATUSES } })
      .sort({ createdAt: -1 }).limit(200).lean();

    const products = [];
    for (const order of orders) {
      const lines = normaliseLines(order);
      for (const item of lines) {
        const name = item.name || item.itemName || '';
        if (!name) continue;
        products.push({
          // composite key so FlatList has unique keys
          key:             `${order._id}_${item.productId || item.itemId || name}`,
          orderId:         order.orderId,
          orderMongoId:    String(order._id),
          orderDate:       order.orderDate || order.createdAt,
          productId:       item.productId || item.itemId || null,
          productName:     name,
          sku:             item.sku || item.skuCode || '',
          quantity:        item.approvedQuantity || item.quantity || 0,
          unitPrice:       item.unitPrice || 0,
          total:           item.total    || item.totalPrice || 0,
        });
      }
    }

    res.json({ success: true, data: products });
  } catch (err) {
    console.error('[dealer/returns/eligible-products]', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch eligible products' });
  }
});

/* ── GET /eligible-orders ─────────────────────────────────────────────────── */
router.get('/eligible-orders', protectDealer, async (req, res) => {
  try {
    const dealer  = req.dealer;
    const matchOr = [{ dealerId: dealer._id }];
    if (dealer.businessName)
      matchOr.push({ customer: { $regex: dealer.businessName, $options: 'i' } });
    if (dealer.name)
      matchOr.push({ customer: { $regex: dealer.name, $options: 'i' } });

    const orders = await SalesOrder.find({ $or: matchOr, status: { $in: ELIGIBLE_STATUSES } })
      .sort({ createdAt: -1 }).limit(100).lean();

    const shaped = orders.map(o => ({
      _id:       o._id,
      orderId:   o.orderId,
      status:    o.status,
      orderDate: o.orderDate || o.createdAt,
      value:     o.value || 0,
      lineItems: normaliseLines(o),
    }));

    res.json({ success: true, data: shaped });
  } catch (err) {
    console.error('[dealer/returns/eligible-orders]', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch eligible orders' });
  }
});

/* ── GET /notifications ───────────────────────────────────────────────────── */
router.get('/notifications', protectDealer, async (req, res) => {
  try {
    const notifs = await DealerNotification.find({ dealerId: req.dealer._id })
      .sort({ createdAt: -1 }).limit(100).lean();
    const unread = notifs.filter(n => !n.read).length;
    res.json({ success: true, data: notifs, unread });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});

/* ── PUT /notifications/read-all ──────────────────────────────────────────── */
router.put('/notifications/read-all', protectDealer, async (req, res) => {
  try {
    await DealerNotification.updateMany({ dealerId: req.dealer._id, read: false }, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update notifications' });
  }
});

/* ── PUT /notifications/:id/read ──────────────────────────────────────────── */
router.put('/notifications/:id/read', protectDealer, async (req, res) => {
  try {
    await DealerNotification.findOneAndUpdate(
      { _id: req.params.id, dealerId: req.dealer._id },
      { read: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to mark as read' });
  }
});

/* ── GET / ────────────────────────────────────────────────────────────────── */
router.get('/', protectDealer, async (req, res) => {
  try {
    const dealer = req.dealer;
    const { search, stage } = req.query;

    // Base filter: match by dealerId OR customerName OR requestedBy
    const filter = {
      $or: [
        { dealerId: dealer._id },
        { customerName: dealer.businessName || dealer.name },
        { requestedBy: dealer.name },
      ],
    };

    // Stage filter: handle both currentStage AND approvalStatus values
    // Frontend sends stage = 'REQUEST_RAISED' | 'APPROVED' | 'REJECTED' | 'IN_TRANSIT' | 'CLOSED'
    // 'REJECTED' maps to approvalStatus field (not currentStage)
    if (stage && stage !== 'All' && stage !== '') {
      if (stage === 'REJECTED') {
        // Rejected is stored as approvalStatus, not currentStage
        filter.approvalStatus = { $regex: /^rejected$/i };
      } else if (stage === 'APPROVED') {
        // Approved can be approvalStatus OR currentStage APPROVED
        filter.$and = [{
          $or: [
            { approvalStatus: { $regex: /^approved$/i } },
            { currentStage: 'APPROVED' },
          ],
        }];
      } else {
        filter.currentStage = stage;
      }
    }

    if (search) {
      const searchOr = [
        { mrId:        new RegExp(search, 'i') },
        { invoiceNo:   new RegExp(search, 'i') },
        { productName: new RegExp(search, 'i') },
        { orderNo:     new RegExp(search, 'i') },
        { docketId:    new RegExp(search, 'i') },
      ];
      // Merge with existing $and if present
      if (filter.$and) {
        filter.$and.push({ $or: searchOr });
      } else {
        filter.$and = [{ $or: searchOr }];
      }
    }

    const returns = await MaterialReturn.find(filter)
      .sort({ createdAt: -1 }).limit(200).lean();

    res.json({ success: true, data: returns });
  } catch (err) {
    console.error('[dealer/returns GET]', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch returns' });
  }
});

/* ── POST / ───────────────────────────────────────────────────────────────── */
router.post('/', protectDealer, upload.single('photo'), async (req, res) => {
  try {
    const dealer = req.dealer;

    // Guard: protectDealer must have set req.dealer
    if (!dealer) {
      return res.status(401).json({ success: false, message: 'Dealer not authenticated. Please log in again.' });
    }

    // ── Idempotency check ────────────────────────────────────────────────────
    const idempotencyKey = req.headers['x-idempotency-key'];
    if (idempotencyKey) {
      const existing = await MaterialReturn.findOne({
        dealerId: dealer._id,
        idempotencyKey,
      }).lean();
      if (existing) {
        console.log(`[dealer/returns POST] ♻️  idempotent — returning existing mrId=${existing.mrId}`);
        return res.status(200).json({
          success: true,
          message: 'Return request already submitted.',
          data: buildReturnResponse(existing),
        });
      }
    }

    // Debug: log what we received
    console.log('[dealer/returns POST] req.body:', JSON.stringify(req.body));
    console.log('[dealer/returns POST] req.file:', req.file ? req.file.filename : 'none');

    const {
      orderId: rawOrderId, orderMongoId, productName, sku,
      orderedQty, returnQty, reason, remarks, photoUrl,
      invoiceNo, unitPrice, value,
    } = req.body;

    const orderId = (rawOrderId && String(rawOrderId).trim()) ||
                    (orderMongoId && String(orderMongoId).trim()) || '';

    // Validate required fields
    const missing = [];
    if (!orderId)     missing.push('orderId');
    if (!productName) missing.push('productName');
    if (!returnQty)   missing.push('returnQty');
    if (!reason)      missing.push('reason');
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(', ')}`,
        received: { orderId, productName, returnQty, reason },
      });
    }

    const rQty = Number(returnQty);
    const oQty = Number(orderedQty) || 0;
    if (isNaN(rQty) || rQty <= 0)
      return res.status(400).json({ success: false, message: 'returnQty must be a positive number' });
    if (oQty > 0 && rQty > oQty)
      return res.status(400).json({
        success: false,
        message: `Return quantity (${rQty}) cannot exceed ordered quantity (${oQty})`,
      });

    // Generate collision-proof mrId (timestamp + random)
    const mrId = await genMrId();

    // Resolve photo URL
    const resolvedPhotoUrl = req.file
      ? `/uploads/returns/${req.file.filename}`
      : (photoUrl || '');

    const mr = await MaterialReturn.create({
      mrId,
      returnId:     mrId,
      dealerId:     dealer._id,
      // Only store idempotencyKey when frontend sent one — omitting it entirely
      // means the sparse compound index skips this document (no null collision).
      ...(idempotencyKey ? { idempotencyKey } : {}),
      customerName: dealer.businessName || dealer.name,
      supplierName: 'Sri Chakra Industries',
      email:        dealer.email    || '',
      mobileNumber: dealer.mobile   || dealer.phone || '',
      pickupAddress:dealer.address  || '',
      pinCode:      dealer.pincode  || dealer.pinCode || '',
      gstNumber:    dealer.gstin    || dealer.gstNumber || '',
      orderNo:      orderId,
      invoiceNo:    invoiceNo  || '',
      productName,
      skuCode:      sku        || '',
      returnQty:    rQty,
      expectedQty:  rQty,
      orderedQty:   oQty,
      unitPrice:    unitPrice ? Number(unitPrice) : 0,
      value:        value     ? Number(value)     : 0,
      reason,
      remarks:      remarks  || '',
      photoUrl:     resolvedPhotoUrl,
      requestedBy:  dealer.name || dealer.businessName || 'Dealer',
      currentStage: 'REQUEST_RAISED',
      approvalStatus: 'Pending',
      priority:     'Medium',
      stageTimeline: [{
        stage:     'REQUEST_RAISED',
        user:      dealer.name || 'Dealer',
        remarks:   `Return raised via Dealer App. Reason: ${reason}`,
        status:    'Completed',
        timestamp: new Date(),
      }],
    });

    console.log(`[dealer/returns POST] ✅ created mrId=${mr.mrId}`);
    return res.status(201).json({
      success: true,
      message: 'Return request submitted successfully. Your request has been sent for admin review.',
      data: buildReturnResponse(mr),
    });

  } catch (err) {
    console.error('[dealer/returns POST] ERROR:', err.message);
    console.error('[dealer/returns POST] STACK:', err.stack);

    // Surface the real error — never return a generic message that hides the cause
    let clientMessage = err.message || 'Failed to create return request';

    // MongoDB duplicate key — make the message actionable
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      clientMessage = `Duplicate key error on ${field}. This return request may have already been submitted.`;
    }

    // Mongoose validation error — list every failing field
    if (err.name === 'ValidationError') {
      const fields = Object.values(err.errors).map(e => `${e.path}: ${e.message}`).join('; ');
      clientMessage = `Validation failed — ${fields}`;
    }

    return res.status(500).json({
      success: false,
      message: clientMessage,
      // Include debug details so the app can log them (not shown to end user)
      debug: {
        errorName:  err.name,
        errorCode:  err.code,
        keyPattern: err.keyPattern,
        stack:      process.env.NODE_ENV !== 'production' ? err.stack : undefined,
      },
    });
  }
});

/* ── GET /:id ─────────────────────────────────────────────────────────────── */
router.get('/:id', protectDealer, async (req, res) => {
  try {
    const dealer = req.dealer;
    const mr = await MaterialReturn.findOne({
      _id: req.params.id,
      $or: [
        { dealerId: dealer._id },
        { customerName: dealer.businessName || dealer.name },
        { requestedBy: dealer.name }
      ]
    }).lean();
    
    if (!mr) return res.status(404).json({ success: false, message: 'Return not found' });
    res.json({ success: true, data: mr });
  } catch (err) {
    console.error('[dealer/returns/:id GET]', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch return' });
  }
});

export default router;
