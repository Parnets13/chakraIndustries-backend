import QualityCheck from '../models/QualityCheck.js';
import GRN from '../models/GRN.js';
import Approval from '../models/Approval.js';
import POInvoice from '../models/POInvoice.js';
import { updateInventoryFromQC } from './inventoryController.js';

const generateQCId = async () => {
  const year = new Date().getFullYear();
  const prefix = `QC-${year}-`;
  const last = await QualityCheck.findOne({ qcId: new RegExp(`^${prefix}`) }).sort({ qcId: -1 });
  if (!last) return `${prefix}001`;
  const num = parseInt(last.qcId.split('-')[2]) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
};

const generateApprovalId = async () => {
  const year = new Date().getFullYear();
  const prefix = `APR-${year}-`;
  const last = await Approval.findOne({ approvalId: new RegExp(`^${prefix}`) }).sort({ approvalId: -1 });
  if (!last) return `${prefix}001`;
  const num = parseInt(last.approvalId.split('-')[2]) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
};

// Generate GRN Receipt Invoice number: GRNINV-YYYY-NNNN
const generateGRNInvoiceNo = async () => {
  const year = new Date().getFullYear();
  const prefix = `GRNINV-${year}-`;
  const last = await POInvoice.findOne({ invoiceNo: new RegExp(`^${prefix}`) }).sort({ createdAt: -1 });
  if (!last) return `${prefix}0001`;
  const parts = last.invoiceNo.split('-');
  const num = parseInt(parts[parts.length - 1]) || 0;
  return `${prefix}${String(num + 1).padStart(4, '0')}`;
};

// GET all QC records
export const getAllQC = async (req, res) => {
  try {
    const qcs = await QualityCheck.find()
      .populate('grnId', 'grnId receivedQuantity orderedQuantity')
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName vendorId')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: qcs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET stats
export const getQCStats = async (req, res) => {
  try {
    const total    = await QualityCheck.countDocuments();
    const passed   = await QualityCheck.countDocuments({ status: 'Passed' });
    const partial  = await QualityCheck.countDocuments({ status: 'Partial' });
    const pending  = await QualityCheck.countDocuments({ status: 'Pending' });
    const rejected = await QualityCheck.countDocuments({ status: 'Rejected' });
    res.json({ success: true, data: { total, passed, partial, pending, rejected } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET one
export const getQCById = async (req, res) => {
  try {
    const qc = await QualityCheck.findById(req.params.id)
      .populate('grnId', 'grnId receivedQuantity orderedQuantity items')
      .populate('poId', 'poId grandTotal items')
      .populate('vendorId', 'companyName vendorId');
    if (!qc) return res.status(404).json({ success: false, message: 'QC not found' });
    res.json({ success: true, data: qc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST submit QC result (pass/fail items)
export const submitQC = async (req, res) => {
  try {
    const { id } = req.params;
    const { items, inspectedBy, remarks } = req.body;

    const qc = await QualityCheck.findById(id);
    if (!qc) return res.status(404).json({ success: false, message: 'QC not found' });

    const totalFailed = items.reduce((s, i) => s + (i.failedQty || 0), 0);
    const totalPassed = items.reduce((s, i) => s + (i.passedQty || 0), 0);
    const newStatus = totalFailed === 0 ? 'Passed' : totalPassed === 0 ? 'Rejected' : 'Partial';

    qc.items = items;
    qc.status = newStatus;
    qc.inspectedBy = inspectedBy || '';
    qc.inspectedAt = new Date();
    qc.remarks = remarks || '';
    await qc.save();

    // Get GRN to extract warehouse info
    const grn = await GRN.findById(qc.grnId);
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });

    // Update GRN qcStatus — must match GRN model enum: 'Not Started','Pending','Passed','Partial','Rejected'
    const grnQcStatus = newStatus === 'Passed' ? 'Passed' : newStatus === 'Partial' ? 'Partial' : 'Rejected';
    await GRN.findByIdAndUpdate(qc.grnId, { qcStatus: grnQcStatus });

    console.log(`[QC SUBMIT] QC ${qc.qcId} submitted with status: ${newStatus}`);

    // If passed or partial → update inventory with passed qty
    if (newStatus === 'Passed' || newStatus === 'Partial') {
      // ── 1. Compute accepted/rejected totals from QC items ────────────────────
      const totalAccepted = items.reduce((s, i) => s + (i.passedQty || 0), 0);
      const totalRejected = items.reduce((s, i) => s + (i.failedQty || 0), 0);

      // Update GRN accepted/rejected quantities
      await GRN.findByIdAndUpdate(qc.grnId, {
        acceptedQuantity: totalAccepted,
        rejectedQuantity: totalRejected,
      });

      // ── 2. Add accepted stock to inventory ────────────────────────────────────
      console.log(`[QC SUBMIT] Triggering inventory update for GRN: ${grn.grnId}`);
      await updateInventoryFromQC({
        items: qc.items,
        grnId: qc.grnId,
        poId: qc.poId,
        vendorId: qc.vendorId,
        warehouseId: grn.warehouseId,
      });

      // ── 3. Auto-create Approval record ────────────────────────────────────────
      const existingApproval = await Approval.findOne({ grnId: qc.grnId });
      if (!existingApproval) {
        const approvalId = await generateApprovalId();
        const poData = await GRN.findById(qc.grnId)
          .populate('poId', 'grandTotal items')
          .populate('vendorId', 'companyName');
        await Approval.create({
          approvalId,
          docType: 'GRN',
          docRef: grn?.grnId || '',
          docId: qc.grnId,
          grnId: qc.grnId,
          poId: qc.poId,
          vendorId: qc.vendorId,
          amount: poData?.poId?.grandTotal || 0,
          requestedBy: inspectedBy || 'QC Inspector',
          department: 'Procurement',
          status: 'Pending',
        });
        await GRN.findByIdAndUpdate(qc.grnId, { approvalStatus: 'Pending' });
      }

      // ── 4. Auto-generate GRN Receipt Invoice (POInvoice) ─────────────────────
      // Use poRef containing the GRN ID as an idempotent check so we never
      // create two GRNINV invoices for the same GRN.
      const grnInvoiceExists = await POInvoice.findOne({
        invoiceNo: new RegExp(`^GRNINV-`),
        poRef: grn.grnId,
      });

      if (!grnInvoiceExists) {
        try {
          // Fetch full GRN + PO + vendor data for invoice
          const grnFull = await GRN.findById(qc.grnId)
            .populate('poId', 'poId grandTotal subtotal gstTotal items paymentTerms vendor')
            .populate('vendorId', 'companyName contactPerson phone email address gstin')
            .populate('warehouseId', 'name location address');

          const po = grnFull?.poId;
          const vendor = grnFull?.vendorId;

          // Build invoice line items from QC-passed items (use PO prices when available)
          const poItemMap = {};
          if (po?.items) {
            po.items.forEach(pi => { poItemMap[pi.name?.toLowerCase()] = pi; });
          }

          const invoiceItems = qc.items
            .filter(it => (it.passedQty || 0) > 0)
            .map(it => {
              const poItem = poItemMap[it.itemName?.toLowerCase()] || {};
              const passedQty = it.passedQty || 0;
              const basePrice = poItem.basePrice || 0;
              const gstRate   = poItem.gst || 18;
              const taxableValue = passedQty * basePrice;
              const gstAmt    = +(taxableValue * gstRate / 100).toFixed(2);
              const cgstVal   = +(gstAmt / 2).toFixed(2);
              const sgstVal   = +(gstAmt / 2).toFixed(2);
              const lineTotal = +(taxableValue + gstAmt).toFixed(2);

              return {
                itemName:      it.itemName,
                requestedQty:  it.receivedQty || 0,
                availableQty:  it.receivedQty || 0,
                invoicedQty:   passedQty,
                pendingQty:    (it.receivedQty || 0) - passedQty,
                unit:          poItem.unit || it.unit || 'Nos',
                basePrice,
                gst:           gstRate,
                cgst:          gstRate / 2,
                sgst:          gstRate / 2,
                igst:          0,
                cgstVal,
                sgstVal,
                igstVal:       0,
                discount:      0,
                taxableValue:  +taxableValue.toFixed(2),
                lineTotal,
                hsn:           '',
              };
            });

          const subtotal  = invoiceItems.reduce((s, i) => s + i.taxableValue, 0);
          const gstTotal  = invoiceItems.reduce((s, i) => s + i.cgstVal + i.sgstVal + i.igstVal, 0);
          const grandTotal = +(subtotal + gstTotal).toFixed(2);

          const grnInvoiceNo = await generateGRNInvoiceNo();
          const isPartial = qc.items.some(it => (it.failedQty || 0) > 0);

          await POInvoice.create({
            invoiceNo:    grnInvoiceNo,
            poId:         qc.poId || null,
            poRef:        grn.grnId,   // always set to GRN ID for idempotency tracking
            vendorName:   vendor?.companyName || '',
            buyerName:    'Sri Chakra Industries',
            buyerAddress: grnFull?.warehouseId?.address || grnFull?.warehouseId?.location || '',
            buyerGSTIN:   '',
            shipToName:   grnFull?.warehouseId?.name || '',
            shipToAddress: grnFull?.warehouseId?.location || '',
            items:        invoiceItems,
            subtotal:     +subtotal.toFixed(2),
            gstTotal:     +gstTotal.toFixed(2),
            grandTotal,
            invoiceType:  isPartial ? 'partial' : 'full',
            status:       'Draft',
          });

          console.log(`[QC SUBMIT] ✅ GRN Receipt Invoice ${grnInvoiceNo} auto-created for GRN ${grn.grnId}`);
        } catch (invoiceErr) {
          // Don't fail QC submission if invoice creation fails — log and continue
          console.error(`[QC SUBMIT] ⚠ GRN Invoice creation failed (non-fatal): ${invoiceErr.message}`);
        }
      }

      // ── 5. Update GRN status to Inventory_Updated ────────────────────────────
      await GRN.findByIdAndUpdate(qc.grnId, { grnStatus: 'Inventory_Updated' });
      console.log(`[QC SUBMIT] ✅ GRN ${grn.grnId} status updated to Inventory_Updated`);
    }

    const populated = await QualityCheck.findById(id)
      .populate('grnId', 'grnId')
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName');

    res.json({ success: true, data: populated });
  } catch (err) {
    console.error('[QC SUBMIT] ❌ Error in submitQC:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};
