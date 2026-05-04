import PackingJob from '../models/PackingJob.js';

export const getAllPackingJobs = async (req, res) => {
  try {
    const { status } = req.query;
    let query = {};
    if (status && status !== 'All') {
      query.status = status;
    }
    const jobs = await PackingJob.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching packing jobs', error: error.message });
  }
};

export const getPackingJobById = async (req, res) => {
  try {
    const job = await PackingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Packing job not found' });
    res.json({ success: true, data: job });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching packing job', error: error.message });
  }
};

export const createPackingJob = async (req, res) => {
  try {
    const { orderId, items, weight, boxType } = req.body;
    if (!orderId || !items) {
      return res.status(400).json({ success: false, message: 'orderId and items are required' });
    }
    const packId = `PKG-${String(await PackingJob.countDocuments() + 1).padStart(3, '0')}`;
    const job = new PackingJob({ packId, orderId, items, weight, boxType: boxType || 'Standard Box', status: 'Pending' });
    await job.save();
    res.status(201).json({ success: true, message: 'Packing job created', data: job });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error creating packing job', error: error.message });
  }
};

export const updatePackingJob = async (req, res) => {
  try {
    const job = await PackingJob.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!job) return res.status(404).json({ success: false, message: 'Packing job not found' });
    res.json({ success: true, message: 'Packing job updated', data: job });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error updating packing job', error: error.message });
  }
};

export const deletePackingJob = async (req, res) => {
  try {
    const job = await PackingJob.findByIdAndDelete(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Packing job not found' });
    res.json({ success: true, message: 'Packing job deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting packing job', error: error.message });
  }
};
