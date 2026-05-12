import { Vehicle, Dispatch, CourierShipment } from '../models/Logistics.js';
import { courierService } from '../utils/courierService.js';

// ── ID generators ─────────────────────────────────────────────────────────────
const genId = async (Model, field, prefix) => {
  const year = new Date().getFullYear();
  const p = `${prefix}-${year}-`;
  const last = await Model.findOne({ [field]: new RegExp(`^${p}`) }).sort({ [field]: -1 });
  if (!last) return `${p}001`;
  const num = parseInt(last[field].split('-').pop()) || 0;
  return `${p}${String(num + 1).padStart(3, '0')}`;
};

// ── VEHICLES ──────────────────────────────────────────────────────────────────
export const getVehicles = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const list = await Vehicle.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createVehicle = async (req, res) => {
  try {
    const vehicleId = await genId(Vehicle, 'vehicleId', 'VH');
    const vehicle = await Vehicle.create({ ...req.body, vehicleId });
    res.status(201).json({ success: true, data: vehicle });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!vehicle) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: vehicle });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteVehicle = async (req, res) => {
  try {
    await Vehicle.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── DISPATCHES ────────────────────────────────────────────────────────────────
export const getDispatches = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const list = await Dispatch.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getDispatchStats = async (req, res) => {
  try {
    const total       = await Dispatch.countDocuments();
    const inTransit   = await Dispatch.countDocuments({ status: 'In Transit' });
    const delivered   = await Dispatch.countDocuments({ status: 'Delivered' });
    const pending     = await Dispatch.countDocuments({ status: 'Pending' });
    const vehicles    = await Vehicle.countDocuments({ status: 'Available' });
    res.json({ success: true, data: { total, inTransit, delivered, pending, availableVehicles: vehicles } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createDispatch = async (req, res) => {
  try {
    const dispatchId = await genId(Dispatch, 'dispatchId', 'DSP');
    const dispatch = await Dispatch.create({
      ...req.body,
      dispatchId,
      status: 'Dispatched',
      timeline: [{ event: 'Order Dispatched', location: req.body.origin || '', status: 'success' }],
    });
    res.status(201).json({ success: true, data: dispatch });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateDispatchStatus = async (req, res) => {
  try {
    const { status, location, event } = req.body;
    const dispatch = await Dispatch.findById(req.params.id);
    if (!dispatch) return res.status(404).json({ success: false, message: 'Not found' });
    dispatch.status = status;
    if (status === 'Delivered') dispatch.deliveredAt = new Date();
    dispatch.timeline.push({ event: event || status, location: location || '', status: 'success' });
    await dispatch.save();
    res.json({ success: true, data: dispatch });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteDispatch = async (req, res) => {
  try {
    await Dispatch.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── COURIER SHIPMENTS ─────────────────────────────────────────────────────────
export const getShipments = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const list = await CourierShipment.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createShipment = async (req, res) => {
  try {
    const shipmentId = await genId(CourierShipment, 'shipmentId', 'SHP');
    const shipment = await CourierShipment.create({ ...req.body, shipmentId });
    res.status(201).json({ success: true, data: shipment });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateShipment = async (req, res) => {
  try {
    const shipment = await CourierShipment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!shipment) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: shipment });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const markPOD = async (req, res) => {
  try {
    const { receivedBy, deliveredAt } = req.body;
    const shipment = await CourierShipment.findByIdAndUpdate(
      req.params.id,
      { pod: true, receivedBy, deliveredAt: deliveredAt || new Date(), status: 'Delivered' },
      { new: true }
    );
    if (!shipment) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: shipment });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteShipment = async (req, res) => {
  try {
    await CourierShipment.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── COURIER TRACKING ──────────────────────────────────────────────────────────
export const trackCourier = async (req, res) => {
  try {
    const { awbNo } = req.params;
    const { courier } = req.query;
    const tracking = await courierService.track(awbNo, courier);
    res.json({ success: true, data: tracking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DC REGULARIZATION ─────────────────────────────────────────────────────────
export const regularizeDispatch = async (req, res) => {
  try {
    const dispatch = await Dispatch.findById(req.params.id);
    if (!dispatch) return res.status(404).json({ success: false, message: 'Dispatch not found' });
    if (dispatch.regularized) return res.status(400).json({ success: false, message: 'Already regularized' });

    dispatch.regularized = true;
    dispatch.regularizedAt = new Date();
    await dispatch.save();

    res.json({ success: true, data: dispatch, message: 'Dispatch regularized successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PENDENCY REPORT ───────────────────────────────────────────────────────────
export const getPendencyReport = async (req, res) => {
  try {
    const pending = await Dispatch.find({
      status: { $in: ['Pending', 'Dispatched', 'In Transit'] }
    }).sort({ createdAt: 1 });

    const now = Date.now();
    const report = pending.map(d => ({
      ...d.toObject(),
      ageDays: Math.floor((now - new Date(d.createdAt)) / 86400000),
      urgency: Math.floor((now - new Date(d.createdAt)) / 86400000) > 14 ? 'critical'
               : Math.floor((now - new Date(d.createdAt)) / 86400000) > 7 ? 'high' : 'normal'
    }));

    res.json({
      success: true,
      data: report,
      summary: {
        total: report.length,
        overdue: report.filter(r => r.ageDays > 7).length,
        critical: report.filter(r => r.ageDays > 14).length,
        totalValue: report.reduce((s, r) => s + (r.value || 0), 0)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
