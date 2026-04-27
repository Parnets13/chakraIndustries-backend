import DeliverySchedule from '../models/DeliverySchedule.js';

const generateScheduleId = async () => {
  const last = await DeliverySchedule.findOne({}, {}, { sort: { createdAt: -1 } });
  if (!last) return 'DS-2024-001';
  const num = parseInt(last.scheduleId.split('-')[2] || '0') + 1;
  return `DS-2024-${String(num).padStart(3, '0')}`;
};

export const createDeliverySchedule = async (req, res) => {
  try {
    const scheduleId = await generateScheduleId();
    const schedule = await DeliverySchedule.create({ ...req.body, scheduleId });
    res.status(201).json({ success: true, data: schedule });
  } catch (err) {
    const message = err.message || 'Failed to create delivery schedule';
    res.status(400).json({ success: false, message });
  }
};

export const getAllDeliverySchedules = async (req, res) => {
  try {
    const { search, status, quotationId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (quotationId) filter.quotationId = quotationId;
    if (search) {
      filter.$or = [
        { scheduleId: { $regex: search, $options: 'i' } },
        { quotationId: { $regex: search, $options: 'i' } },
        { client: { $regex: search, $options: 'i' } },
      ];
    }
    const schedules = await DeliverySchedule.find(filter).sort({ deliveryDate: 1 });
    res.json({ success: true, data: schedules });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getDeliveryScheduleById = async (req, res) => {
  try {
    const schedule = await DeliverySchedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ success: false, message: 'Delivery schedule not found' });
    res.json({ success: true, data: schedule });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateDeliverySchedule = async (req, res) => {
  try {
    const schedule = await DeliverySchedule.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!schedule) return res.status(404).json({ success: false, message: 'Delivery schedule not found' });
    res.json({ success: true, data: schedule });
  } catch (err) {
    const message = err.message || 'Failed to update delivery schedule';
    res.status(400).json({ success: false, message });
  }
};

export const deleteDeliverySchedule = async (req, res) => {
  try {
    const schedule = await DeliverySchedule.findByIdAndDelete(req.params.id);
    if (!schedule) return res.status(404).json({ success: false, message: 'Delivery schedule not found' });
    res.json({ success: true, message: 'Delivery schedule deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
