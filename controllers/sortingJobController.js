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
    console.log('--- CREATE SORTING JOB REQUEST ---');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { orderId, sku, itemName, quantity, grade } = req.body;
    
    // Validate required fields
    if (!orderId) {
      console.log('Validation Error: orderId is missing');
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }
    if (!sku) {
      console.log('Validation Error: sku is missing');
      return res.status(400).json({ success: false, message: 'sku is required' });
    }
    if (quantity === undefined || quantity === null || quantity === '') {
      console.log('Validation Error: quantity is missing or empty');
      return res.status(400).json({ success: false, message: 'quantity is required' });
    }
    
    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0) {
      console.log('Validation Error: quantity is not a valid positive number:', quantity);
      return res.status(400).json({ success: false, message: 'quantity must be a valid positive number' });
    }
    
    const sortId = `SRT-${String(await SortingJob.countDocuments() + 1).padStart(3, '0')}`;
    const job = new SortingJob({ 
      sortId, 
      orderId, 
      sku, 
      itemName: itemName || 'Unknown Item', 
      quantity: qty, 
      grade: grade || 'Grade A', 
      status: 'Pending' 
    });
    
    await job.save();
    console.log('Sorting job created successfully:', job.sortId);
    res.status(201).json({ success: true, message: 'Sorting job created', data: job });
  } catch (error) {
    console.error('Error in createSortingJob:', error);
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
