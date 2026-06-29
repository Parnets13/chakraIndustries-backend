import Production from '../models/Production.js';

/* ─── helpers ─────────────────────────────────────────────────────────── */
const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return { $gte: new Date(y, m - 1, 1), $lt: new Date(y, m, 1) };
};
const todayRange = () => {
  const now = new Date();
  return { $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()), $lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) };
};

/* ─── GET /  (list with filters) ─────────────────────────────────────── */
export const getAll = async (req, res) => {
  try {
    const { month, company, product, search, shift, status, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (month)   filter.productionDate = monthRange(month);
    if (company) filter.companyName    = new RegExp(company, 'i');
    if (product) filter.productName    = new RegExp(product, 'i');
    if (shift)   filter.shift          = shift;
    if (status)  filter.status         = status;
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [{ companyName: re }, { productName: re }, { productCode: re }, { machineName: re }, { operatorName: re }];
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Production.countDocuments(filter);
    const data  = await Production.find(filter)
      .sort({ productionDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({ success: true, data, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ─── GET /dashboard ─────────────────────────────────────────────────── */
export const getDashboard = async (req, res) => {
  try {
    const [allAgg, todayAgg] = await Promise.all([
      Production.aggregate([
        { $group: {
          _id:              null,
          totalProductions: { $sum: 1 },
          totalPlanned:     { $sum: '$plannedQty' },
          totalProduced:    { $sum: '$producedQty' },
          totalGood:        { $sum: '$goodQty' },
          totalDamaged:     { $sum: '$damagedQty' },
          totalRejected:    { $sum: '$rejectedQty' },
          totalRework:      { $sum: '$reworkQty' },
          totalGoodValue:   { $sum: '$totalGoodValue' },
          totalLoss:        { $sum: '$totalLoss' },
          netProfit:        { $sum: '$netProfit' },
          avgEfficiency:    { $avg: '$efficiencyPercentage' },
          avgDamageRate:    { $avg: '$damagePercentage' },
        }},
      ]),
      Production.aggregate([
        { $match: { productionDate: todayRange() } },
        { $group: {
          _id:           null,
          todayCount:    { $sum: 1 },
          todayProduced: { $sum: '$producedQty' },
          todayGood:     { $sum: '$goodQty' },
          todayDamaged:  { $sum: '$damagedQty' },
        }},
      ]),
    ]);

    const s = allAgg[0] || {};
    const t = todayAgg[0] || {};

    res.json({
      success: true,
      data: {
        totalProductions: s.totalProductions || 0,
        totalProduced:    s.totalProduced    || 0,
        totalGood:        s.totalGood        || 0,
        totalDamaged:     s.totalDamaged     || 0,
        totalRejected:    s.totalRejected    || 0,
        totalRework:      s.totalRework      || 0,
        totalGoodValue:   parseFloat((s.totalGoodValue || 0).toFixed(2)),
        totalLoss:        parseFloat((s.totalLoss      || 0).toFixed(2)),
        netProfit:        parseFloat((s.netProfit       || 0).toFixed(2)),
        avgEfficiency:    parseFloat((s.avgEfficiency  || 0).toFixed(2)),
        avgDamageRate:    parseFloat((s.avgDamageRate  || 0).toFixed(2)),
        todayCount:       t.todayCount    || 0,
        todayProduced:    t.todayProduced || 0,
        todayGood:        t.todayGood     || 0,
        todayDamaged:     t.todayDamaged  || 0,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ─── GET /monthly-report ────────────────────────────────────────────── */
export const getMonthlyReport = async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ success: false, message: 'month required (YYYY-MM)' });

    const filter = { productionDate: monthRange(month) };
    const [summary] = await Production.aggregate([
      { $match: filter },
      { $group: {
        _id:           null,
        totalEntries:  { $sum: 1 },
        totalPlanned:  { $sum: '$plannedQty' },
        totalProduced: { $sum: '$producedQty' },
        totalGood:     { $sum: '$goodQty' },
        totalDamaged:  { $sum: '$damagedQty' },
        totalRejected: { $sum: '$rejectedQty' },
        totalRework:   { $sum: '$reworkQty' },
        totalGoodValue:{ $sum: '$totalGoodValue' },
        totalLoss:     { $sum: '$totalLoss' },
        netProfit:     { $sum: '$netProfit' },
        avgEfficiency: { $avg: '$efficiencyPercentage' },
        avgDamageRate: { $avg: '$damagePercentage' },
      }},
    ]);

    const data = summary || {};
    Object.keys(data).forEach(k => {
      if (k !== '_id' && typeof data[k] === 'number') data[k] = parseFloat(data[k].toFixed(2));
    });
    res.json({ success: true, data, month });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ─── GET /:id ───────────────────────────────────────────────────────── */
export const getById = async (req, res) => {
  try {
    const doc = await Production.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ─── POST / ─────────────────────────────────────────────────────────── */
export const create = async (req, res) => {
  try {
    const doc = new Production(req.body);
    await doc.save();
    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

/* ─── PUT /:id ───────────────────────────────────────────────────────── */
export const update = async (req, res) => {
  try {
    const doc = await Production.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    // Re-run pre-save calculations via explicit save
    await doc.save();
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

/* ─── DELETE /:id ────────────────────────────────────────────────────── */
export const remove = async (req, res) => {
  try {
    const doc = await Production.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
