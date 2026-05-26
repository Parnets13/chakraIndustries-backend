import BOM from '../models/BOM.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
async function generateBomId() {
  const last = await BOM.findOne().sort({ createdAt: -1 }).select('bomId');
  let n = 1;
  if (last?.bomId) { const m = last.bomId.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  let id = `BOM-${String(n).padStart(3, '0')}`;
  while (await BOM.findOne({ bomId: id })) { n++; id = `BOM-${String(n).padStart(3, '0')}`; }
  return id;
}

function calcCosts(bom) {
  const mat = bom.components.reduce((s, c) => {
    const qty = c.qty * (1 + (c.scrapFactor || 0) / 100);
    return s + qty * (c.unitCost || 0);
  }, 0);
  const total = mat * (1 + (bom.overheadPct || 0) / 100) + (bom.labourCost || 0);
  return { componentCount: bom.components.length, materialCost: Math.round(mat * 100) / 100, totalCost: Math.round(total * 100) / 100 };
}

// ── GET all BOMs ──────────────────────────────────────────────────────────────
export const getAllBOMs = async (req, res) => {
  try {
    const { status, oemBrand, type } = req.query;
    const filter = {};
    if (status)   filter.status = status;
    if (oemBrand) filter.oemBrand = oemBrand;
    if (type)     filter.type = type;

    const boms = await BOM.find(filter)
      .populate('oemBrand', 'brandId name code color status')
      .populate({
        path: 'components.vendorId',
        select: 'vendorId companyName'
      })
      .populate({
        path: 'components.oemBrand',
        select: 'brandId name code'
      })
      .sort({ createdAt: -1 });

    const data = boms.map(b => {
      const bomObj = b.toObject();
      const costs = calcCosts(b);
      
      // Enhance components with calculated costs
      if (bomObj.components) {
        bomObj.components = bomObj.components.map(comp => ({
          ...comp,
          totalCost: Math.round((comp.qty || 0) * (comp.unitCost || 0) * 100) / 100,
        }));
      }
      
      return { ...bomObj, ...costs };
    });
    
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET single BOM ────────────────────────────────────────────────────────────
export const getBOMById = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id)
      .populate('oemBrand', 'brandId name code color status')
      .populate({
        path: 'components.vendorId',
        select: 'vendorId companyName contactPerson email phone'
      })
      .populate({
        path: 'components.oemBrand',
        select: 'brandId name code color status'
      })
      .populate({
        path: 'components.subBomId',
        select: 'bomId product version status components'
      });

    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    
    const bomData = bom.toObject();
    const costs = calcCosts(bom);
    
    // Enhance components with calculated costs
    if (bomData.components) {
      bomData.components = bomData.components.map(comp => ({
        ...comp,
        totalCost: Math.round((comp.qty || 0) * (comp.unitCost || 0) * 100) / 100,
        scrapQty: Math.round((comp.qty || 0) * ((comp.scrapFactor || 0) / 100) * 1000) / 1000,
      }));
    }
    
    res.json({ success: true, data: { ...bomData, ...costs } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET BOM versions (all versions of same product) ───────────────────────────
export const getBOMVersions = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id).select('product productCode');
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const versions = await BOM.find({ product: bom.product }).sort({ createdAt: -1 }).select('bomId version status approvalStatus createdAt');
    res.json({ success: true, data: versions });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── CREATE BOM ────────────────────────────────────────────────────────────────
export const createBOM = async (req, res) => {
  try {
    const { product } = req.body;
    if (!product?.trim()) return res.status(400).json({ success: false, message: 'Product name is required' });
    const bomId = await generateBomId();
    const bom = await BOM.create({ bomId, ...req.body, status: 'Draft', approvalStatus: 'Draft' });
    res.status(201).json({ success: true, message: 'BOM created', data: { ...bom.toObject(), componentCount: 0, materialCost: 0, totalCost: 0 } });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── UPDATE BOM header ─────────────────────────────────────────────────────────
export const updateBOM = async (req, res) => {
  try {
    const bom = await BOM.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    res.json({ success: true, message: 'BOM updated', data: { ...bom.toObject(), ...calcCosts(bom) } });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── DELETE BOM ────────────────────────────────────────────────────────────────
export const deleteBOM = async (req, res) => {
  try {
    const bom = await BOM.findByIdAndDelete(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    res.json({ success: true, message: 'BOM deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── CREATE new version of existing BOM ───────────────────────────────────────
export const createVersion = async (req, res) => {
  try {
    const source = await BOM.findById(req.params.id);
    if (!source) return res.status(404).json({ success: false, message: 'Source BOM not found' });

    const bomId = await generateBomId();
    const { version = 'v2.0', changeNote = '' } = req.body;

    const newBom = await BOM.create({
      bomId,
      product:     source.product,
      productCode: source.productCode,
      version,
      type:        source.type,
      uom:         source.uom,
      description: source.description,
      oemBrand:    source.oemBrand,
      overheadPct: source.overheadPct,
      labourCost:  source.labourCost,
      components:  source.components.map(c => c.toObject()),
      status:      'Draft',
      approvalStatus: 'Draft',
      versionHistory: [{
        version:    source.version,
        changedBy:  req.body.changedBy || '',
        changeNote,
        snapshot:   source.components.map(c => c.toObject()),
      }],
    });

    res.status(201).json({ success: true, message: `New version ${version} created`, data: { ...newBom.toObject(), ...calcCosts(newBom) } });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── APPROVAL WORKFLOW ─────────────────────────────────────────────────────────
// POST /api/bom/:id/submit — submit for approval
export const submitForApproval = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    if (bom.components.length === 0) return res.status(400).json({ success: false, message: 'Cannot submit BOM with no components' });

    bom.approvalStatus = 'Pending Approval';
    bom.status = 'Draft';
    // Default approval step if none set
    if (bom.approvalSteps.length === 0) {
      bom.approvalSteps.push({ approver: req.body.approver || 'Production Manager', role: 'Manager', status: 'Pending' });
    }
    await bom.save();
    res.json({ success: true, message: 'BOM submitted for approval', data: { ...bom.toObject(), ...calcCosts(bom) } });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// PATCH /api/bom/:id/approve — approve or reject
export const approveBOM = async (req, res) => {
  try {
    const { action, approver, remarks } = req.body; // action: 'approve' | 'reject'
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ success: false, message: 'action must be approve or reject' });

    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    if (bom.approvalStatus !== 'Pending Approval') return res.status(400).json({ success: false, message: 'BOM is not pending approval' });

    // Update the pending step
    const step = bom.approvalSteps.find(s => s.status === 'Pending');
    if (step) {
      step.status   = action === 'approve' ? 'Approved' : 'Rejected';
      step.remarks  = remarks || '';
      step.actionAt = new Date();
      if (approver) step.approver = approver;
    }

    if (action === 'approve') {
      bom.approvalStatus = 'Approved';
      bom.status         = 'Active';
      bom.approvedBy     = approver || '';
      bom.approvedAt     = new Date();
    } else {
      bom.approvalStatus = 'Rejected';
    }

    await bom.save();
    res.json({ success: true, message: `BOM ${action}d`, data: { ...bom.toObject(), ...calcCosts(bom) } });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── COMPONENT CRUD ────────────────────────────────────────────────────────────
export const addComponent = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const { itemName, qty } = req.body;
    if (!itemName?.trim()) return res.status(400).json({ success: false, message: 'Item name is required' });
    if (!qty || qty <= 0)  return res.status(400).json({ success: false, message: 'Quantity must be > 0' });

    bom.components.push(req.body);
    await bom.save();
    res.status(201).json({ success: true, message: 'Component added', data: { ...bom.toObject(), ...calcCosts(bom) } });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateComponent = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const comp = bom.components.id(req.params.componentId);
    if (!comp) return res.status(404).json({ success: false, message: 'Component not found' });
    Object.assign(comp, req.body);
    await bom.save();
    res.json({ success: true, message: 'Component updated', data: { ...bom.toObject(), ...calcCosts(bom) } });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteComponent = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const comp = bom.components.id(req.params.componentId);
    if (!comp) return res.status(404).json({ success: false, message: 'Component not found' });
    comp.deleteOne();
    await bom.save();
    res.json({ success: true, message: 'Component removed', data: { ...bom.toObject(), ...calcCosts(bom) } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── ALTERNATE MATERIAL CRUD ───────────────────────────────────────────────────
export const addAlternate = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const comp = bom.components.id(req.params.componentId);
    if (!comp) return res.status(404).json({ success: false, message: 'Component not found' });
    if (!req.body.itemName?.trim()) return res.status(400).json({ success: false, message: 'Alternate item name is required' });
    comp.alternates.push(req.body);
    await bom.save();
    res.status(201).json({ success: true, message: 'Alternate added', data: { ...bom.toObject(), ...calcCosts(bom) } });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteAlternate = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    const comp = bom.components.id(req.params.componentId);
    if (!comp) return res.status(404).json({ success: false, message: 'Component not found' });
    const alt = comp.alternates.id(req.params.alternateId);
    if (!alt) return res.status(404).json({ success: false, message: 'Alternate not found' });
    alt.deleteOne();
    await bom.save();
    res.json({ success: true, message: 'Alternate removed' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── EXPLODE BOM (multi-level) ─────────────────────────────────────────────────
// GET /api/bom/:id/explode?qty=10
// Returns flat list of all materials needed for qty units, including sub-BOMs
export const explodeBOM = async (req, res) => {
  try {
    const qty = parseFloat(req.query.qty) || 1;
    const result = [];

    async function explode(bomId, multiplier, level) {
      const bom = await BOM.findById(bomId).populate('components.subBomId', 'bomId product');
      if (!bom) return;
      for (const c of bom.components) {
        const needed = c.qty * (1 + (c.scrapFactor || 0) / 100) * multiplier;
        result.push({
          level,
          bomId:    bom.bomId,
          itemName: c.itemName,
          itemCode: c.itemCode,
          type:     c.type,
          unit:     c.unit,
          qty:      Math.round(needed * 1000) / 1000,
          unitCost: c.unitCost,
          totalCost: Math.round(needed * c.unitCost * 100) / 100,
          hasSubBom: !!c.subBomId,
          alternates: c.alternates?.length || 0,
        });
        // Recurse into sub-BOM
        if (c.subBomId?._id) {
          await explode(c.subBomId._id, needed, level + 1);
        }
      }
    }

    await explode(req.params.id, qty, 1);
    res.json({ success: true, data: result, totalLines: result.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
