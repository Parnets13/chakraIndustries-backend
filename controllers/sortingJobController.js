import SortingJob from '../models/SortingJob.js';

export const getAllSortingJobs = async (req, res) => {
  try {
    const { status } = req.query;
    let query = {};
    if (status && status !== 'All') {
      query.status = status;
    }
    const jobs = await SortingJob.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching sorting jobs', error: error.message });
  }
};

export const getSortingJobById = async (req, res) => {
  try {
    const job = await SortingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Sorting job not found' });
    res.json({ success: true, data: job });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching sorting job', error: error.message });
  }
};

export const createSortingJob = async (req, res) => {
  try {
    const { orderId, sku, itemName, quantity, grade } = req.body;
    if (!orderId || !sku || quantity === undefined || quantity === null || quantity === '') {
      return res.status(400).json({ success: false, message: 'orderId, sku, and quantity are required' });
    }
    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: 'quantity must be a valid positive number' });
    }
    const sortId = `SRT-${String(await SortingJob.countDocuments() + 1).padStart(3, '0')}`;
    const job = new SortingJob({ sortId, orderId, sku, itemName, quantity: qty, grade: grade || 'Grade A', status: 'Pending' });
    await job.save();
    res.status(201).json({ success: true, message: 'Sorting job created', data: job });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error creating sorting job', error: error.message });
  }
};

export const updateSortingJob = async (req, res) => {
  try {
    const job = await SortingJob.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!job) return res.status(404).json({ success: false, message: 'Sorting job not found' });
    res.json({ success: true, message: 'Sorting job updated', data: job });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error updating sorting job', error: error.message });
  }
};

export const deleteSortingJob = async (req, res) => {
  try {
    const job = await SortingJob.findByIdAndDelete(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Sorting job not found' });
    res.json({ success: true, message: 'Sorting job deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting sorting job', error: error.message });
  }
};
