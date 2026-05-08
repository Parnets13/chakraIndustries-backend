import BOM from '../models/BOM.js';

// ── Auto-generate BOM ID ──────────────────────────────────────────────────────
async function generateBomId() {
  const last = await BOM.findOne().sort({ createdAt: -1 }).select('bomId');
  let nextNum = 1;
  if (last?.bomId) {
    const m = last.bomId.match(/(\d+)$/);
    if (m) nextNum = parseInt(m[1]) + 1;
  }
  let bomId = `BOM-${String(nextNum).padStart(3, '0')}`;
  while (await BOM.findOne({ bomId })) {
    nextNum++;
    bomId = `BOM-${String(nextNum).padStart(3, '0')}`;
  }
  return bomId;
}

// GET /api/bom — list all BOMs
export const getAllBOMs = async (req, res) => {
  try {
    const boms = await BOM.find().sort({ createdAt: -1 });
    const data = boms.map(b => ({
      ...b.toObject(),
      componentCount: b.components.length,
      totalCost: b.components.reduce((s, c) => s + c.qty * c.unitCost, 0),
    }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/bom/:id — single BOM with full component tree
export const getBOMById = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    res.json({
      success: true,
      data: {
        ...bom.toObject(),
        componentCount: bom.components.length,
        totalCost: bom.components.reduce((s, c) => s + c.qty * c.unitCost, 0),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/bom — create BOM (header only, components added separately)
export const createBOM = async (req, res) => {
  try {
    const { product, productCode, version, type, uom, description, status } = req.body;
    if (!product?.trim()) return res.status(400).json({ success: false, message: 'Product name is required' });

    const bomId = await generateBomId();
    const bom = await BOM.create({ bomId, product, productCode, version, type, uom, description, status });
    res.status(201).json({ success: true, message: 'BOM created', data: { ...bom.toObject(), componentCount: 0, totalCost: 0 } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/bom/:id — update BOM header
export const updateBOM = async (req, res) => {
  try {
    const bom = await BOM.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    res.json({ success: true, message: 'BOM updated', data: bom });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/bom/:id — delete BOM
export const deleteBOM = async (req, res) => {
  try {
    const bom = await BOM.findByIdAndDelete(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    res.json({ success: true, message: 'BOM deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/bom/:id/components — add a component
export const addComponent = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });

    const { itemName, itemCode, qty, unit, type, unitCost, remarks } = req.body;
    if (!itemName?.trim()) return res.status(400).json({ success: false, message: 'Item name is required' });
    if (!qty || qty <= 0) return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });

    bom.components.push({ itemName, itemCode, qty, unit, type, unitCost, remarks });
    await bom.save();

    res.status(201).json({
      success: true,
      message: 'Component added',
      data: {
        ...bom.toObject(),
        componentCount: bom.components.length,
        totalCost: bom.components.reduce((s, c) => s + c.qty * c.unitCost, 0),
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/bom/:id/components/:componentId — update a component
export const updateComponent = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });

    const comp = bom.components.id(req.params.componentId);
    if (!comp) return res.status(404).json({ success: false, message: 'Component not found' });

    Object.assign(comp, req.body);
    await bom.save();

    res.json({
      success: true,
      message: 'Component updated',
      data: {
        ...bom.toObject(),
        componentCount: bom.components.length,
        totalCost: bom.components.reduce((s, c) => s + c.qty * c.unitCost, 0),
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/bom/:id/components/:componentId — remove a component
export const deleteComponent = async (req, res) => {
  try {
    const bom = await BOM.findById(req.params.id);
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });

    const comp = bom.components.id(req.params.componentId);
    if (!comp) return res.status(404).json({ success: false, message: 'Component not found' });

    comp.deleteOne();
    await bom.save();

    res.json({
      success: true,
      message: 'Component removed',
      data: {
        ...bom.toObject(),
        componentCount: bom.components.length,
        totalCost: bom.components.reduce((s, c) => s + c.qty * c.unitCost, 0),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
