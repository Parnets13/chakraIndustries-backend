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
    console.log('--- CREATE PACKING JOB REQUEST ---');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { orderId, items, weight, boxType } = req.body;
    
    if (!orderId) {
      console.log('Validation Error: orderId is missing');
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }
    
    if (items === undefined || items === null || items === '') {
      console.log('Validation Error: items is missing or empty');
      return res.status(400).json({ success: false, message: 'items is required' });
    }
    
    const itemCount = parseInt(items);
    if (isNaN(itemCount) || itemCount < 0) {
      console.log('Validation Error: items must be a valid non-negative number:', items);
      return res.status(400).json({ success: false, message: 'items must be a valid non-negative number' });
    }
    
    const packId = `PKG-${String(await PackingJob.countDocuments() + 1).padStart(3, '0')}`;
    const job = new PackingJob({ 
      packId, 
      orderId, 
      items: itemCount, 
      weight: weight || '0', 
      boxType: boxType || 'Standard Box', 
      status: 'Pending' 
    });
    
    await job.save();
    console.log('Packing job created successfully:', job.packId);
    res.status(201).json({ success: true, message: 'Packing job created', data: job });
  } catch (error) {
    console.error('Error in createPackingJob:', error);
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
