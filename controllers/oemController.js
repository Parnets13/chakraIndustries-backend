import OEMBrand   from '../models/OEMBrand.js';
import OEMProduct from '../models/OEMProduct.js';
import WorkOrder  from '../models/WorkOrder.js';

// ── ID generators ─────────────────────────────────────────────────────────────
async function genBrandId() {
  const last = await OEMBrand.findOne().sort({ createdAt: -1 }).select('brandId');
  let n = 1;
  if (last?.brandId) { const m = last.brandId.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  let id = `OEM-${String(n).padStart(3, '0')}`;
  while (await OEMBrand.findOne({ brandId: id })) { n++; id = `OEM-${String(n).padStart(3, '0')}`; }
  return id;
}

// ══════════════════════════════════════════════════════════════════════════════
// OEM BRANDS
// ══════════════════════════════════════════════════════════════════════════════

export const getAllBrands = async (req, res) => {
  try {
    const brands = await OEMBrand.find().sort({ createdAt: -1 });
    // Attach product count to each brand
    const data = await Promise.all(brands.map(async b => {
      const productCount = await OEMProduct.countDocuments({ oemBrand: b._id });
      return { ...b.toObject(), productCount };
    }));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getBrandById = async (req, res) => {
  try {
    const brand = await OEMBrand.findById(req.params.id);
    if (!brand) return res.status(404).json({ success: false, message: 'OEM brand not found' });
    const productCount = await OEMProduct.countDocuments({ oemBrand: brand._id });
    res.json({ success: true, data: { ...brand.toObject(), productCount } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createBrand = async (req, res) => {
  try {
    const { name, code } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Brand name is required' });
    if (!code?.trim()) return res.status(400).json({ success: false, message: 'Brand code is required' });
    const brandId = await genBrandId();
    const brand = await OEMBrand.create({ brandId, ...req.body });
    res.status(201).json({ success: true, message: 'OEM brand created', data: { ...brand.toObject(), productCount: 0 } });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateBrand = async (req, res) => {
  try {
    const brand = await OEMBrand.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!brand) return res.status(404).json({ success: false, message: 'OEM brand not found' });
    res.json({ success: true, message: 'OEM brand updated', data: brand });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteBrand = async (req, res) => {
  try {
    const productCount = await OEMProduct.countDocuments({ oemBrand: req.params.id });
    if (productCount > 0)
      return res.status(400).json({ success: false, message: `Cannot delete — brand has ${productCount} product mapping(s). Remove them first.` });
    const brand = await OEMBrand.findByIdAndDelete(req.params.id);
    if (!brand) return res.status(404).json({ success: false, message: 'OEM brand not found' });
    res.json({ success: true, message: 'OEM brand deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// OEM PRODUCTS (per-brand mappings)
// ══════════════════════════════════════════════════════════════════════════════

export const getProductsByBrand = async (req, res) => {
  try {
    const { brandId } = req.params;
    const products = await OEMProduct.find({ oemBrand: brandId })
      .populate('bom', 'bomId product version')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: products });
  } catch (err) { 
    console.error('getProductsByBrand error:', err.message);
    res.status(500).json({ success: false, message: err.message }); 
  }
};

export const getAllProducts = async (req, res) => {
  try {
    const products = await OEMProduct.find()
      .populate('oemBrand', 'brandId name code color')
      .populate('bom', 'bomId product version')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: products });
  } catch (err) { 
    console.error('getAllProducts error:', err.message);
    res.status(500).json({ success: false, message: err.message }); 
  }
};

export const createProduct = async (req, res) => {
  try {
    const { oemBrand, productName } = req.body;
    if (!oemBrand)       return res.status(400).json({ success: false, message: 'OEM brand is required' });
    if (!productName?.trim()) return res.status(400).json({ success: false, message: 'Product name is required' });

    const brand = await OEMBrand.findById(oemBrand);
    if (!brand) return res.status(400).json({ success: false, message: 'OEM brand not found' });

    const product = await OEMProduct.create(req.body);
    const populated = await product.populate([
      { path: 'bom', select: 'bomId product version' },
    ]);
    res.status(201).json({ success: true, message: 'OEM product mapping created', data: populated });
  } catch (err) { 
    console.error('createProduct error:', err.message);
    res.status(400).json({ success: false, message: err.message }); 
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await OEMProduct.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('bom', 'bomId product version');
    if (!product) return res.status(404).json({ success: false, message: 'OEM product not found' });
    res.json({ success: true, message: 'OEM product updated', data: product });
  } catch (err) { 
    console.error('updateProduct error:', err.message);
    res.status(400).json({ success: false, message: err.message }); 
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await OEMProduct.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'OEM product not found' });
    res.json({ success: true, message: 'OEM product mapping deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-SELECT: best OEM for a product based on stock/cost/region
// GET /api/oem/auto-select?productName=X&region=Y
// ══════════════════════════════════════════════════════════════════════════════
export const autoSelectOEM = async (req, res) => {
  try {
    const { productName, region } = req.query;
    if (!productName) return res.status(400).json({ success: false, message: 'productName is required' });

    const query = { productName: new RegExp(productName, 'i'), status: 'Active' };
    if (region) query.preferredRegions = region;

    const candidates = await OEMProduct.find(query)
      .populate('oemBrand', 'brandId name code color status')
      .sort({ autoSelectPriority: -1, unitPrice: 1 });

    // Filter to only active brands
    const active = candidates.filter(p => p.oemBrand?.status === 'Active');

    if (active.length === 0)
      return res.json({ success: true, data: null, message: 'No active OEM found for this product' });

    res.json({ success: true, data: active[0], allCandidates: active });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// WORK ORDERS per OEM brand
// ══════════════════════════════════════════════════════════════════════════════
export const getWOsByBrand = async (req, res) => {
  try {
    const wos = await WorkOrder.find({ oemBrand: req.params.brandId })
      .populate('bomId', 'bomId product version')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: wos });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ══════════════════════════════════════════════════════════════════════════════
export const getOEMStats = async (req, res) => {
  try {
    const brands   = await OEMBrand.find({ status: 'Active' });
    const products = await OEMProduct.find({ status: 'Active' });
    const wos      = await WorkOrder.find({ oemBrand: { $ne: null } });

    const totalProduced = wos.reduce((s, w) => s + (w.produced || 0), 0);
    const totalTarget   = wos.reduce((s, w) => s + (w.qty || 0), 0);

    res.json({
      success: true,
      data: {
        totalBrands:    brands.length,
        totalProducts:  products.length,
        totalWOs:       wos.length,
        completedWOs:   wos.filter(w => w.status === 'Completed').length,
        inProgressWOs:  wos.filter(w => w.status === 'In-Progress').length,
        totalProduced,
        totalTarget,
        overallEfficiency: totalTarget > 0 ? Math.round((totalProduced / totalTarget) * 100) : 0,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
