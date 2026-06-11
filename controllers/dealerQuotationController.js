import BulkQuotation from '../models/BulkQuotation.js';
import BulkQuotationRequest from '../models/BulkQuotationRequest.js';
import CorporateClient from '../models/CorporateClient.js';

const normalizeMobile = (mobile = '') => String(mobile).replace(/\D/g, '').slice(-10);
const normalizeGstin = (gstin = '') => String(gstin).toUpperCase().replace(/\s/g, '');

const getCorporateClientForDealer = async (dealer) => {
  const mobile = normalizeMobile(dealer.mobile);
  const gst = normalizeGstin(dealer.gstin || '');

  let client = null;
  if (gst) client = await CorporateClient.findOne({ gstNumber: gst });
  if (!client && mobile) client = await CorporateClient.findOne({ phone: mobile });
  if (!client) {
    const name = (dealer.businessName || dealer.name || '').trim();
    if (name) client = await CorporateClient.findOne({ name: { $regex: `^${name}$`, $options: 'i' } });
  }
  return client;
};

export const requestDealerQuotation = async (req, res) => {
  try {
    const corporateClient = await getCorporateClientForDealer(req.dealer);
    if (!corporateClient) {
      return res.status(404).json({
        success: false,
        message: 'Dealer is not mapped in ERP Corporate Clients. Please map this dealer in ERP first.',
      });
    }

    const deliveryDate = req.body.deliveryDate ? new Date(req.body.deliveryDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const products = Array.isArray(req.body.products) ? req.body.products : [];
    if (products.length === 0) {
      return res.status(400).json({ success: false, message: 'Products are required' });
    }

    const payload = {
      clientId: corporateClient._id,
      clientName: corporateClient.name,
      deliveryDate,
      products,
      packaging: req.body.packaging || { type: 'Standard', customBranding: false },
      paymentTerms: req.body.paymentTerms || corporateClient.paymentTerms || 'Net 30',
      notes: req.body.notes || '',
      status: 'Submitted',
      workflow: { submittedAt: new Date() },
    };

    const doc = await BulkQuotationRequest.create(payload);
    res.status(201).json({ success: true, data: { requestId: doc.requestId, id: doc._id, status: doc.status } });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Failed to request quotation' });
  }
};

export const getDealerQuotationRequests = async (req, res) => {
  try {
    const corporateClient = await getCorporateClientForDealer(req.dealer);
    if (!corporateClient) return res.json({ success: true, data: [] });

    const status = String(req.query.status || '').trim();
    const filter = { clientId: corporateClient._id };
    if (status && status !== 'All') filter.status = status;

    const rows = await BulkQuotationRequest.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch quotation requests' });
  }
};

export const getDealerApprovedQuotations = async (req, res) => {
  try {
    const clientName = (req.dealer.businessName || req.dealer.name || '').trim();
    if (!clientName) return res.json({ success: true, data: [] });

    const rows = await BulkQuotation.find({ client: clientName, status: 'Approved' }).sort({ createdAt: -1 });
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch approved quotations' });
  }
};

