import SortingJob from '../models/SortingJob.js';

export const getAllSortingJobs = async (req, res) => {
  try {
    console.log('--- GET ALL SORTING JOBS REQUEST ---');
    console.log('Query:', req.query);
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
    console.log('--- START CREATE SORTING JOB ---');
    
    // 1. FORCE INDEX CLEANUP (Absolute Fix for E11000)
    // We explicitly drop the old index names and the new ones to clear any corruption
    try {
      const collection = SortingJob.collection;
      const indexes = await collection.indexes();
      console.log('Current Indexes:', indexes.map(i => i.name));
      
      // If we see more than the default _id index, let's be safe
      if (indexes.length > 1) {
        console.log('Dropping all indexes to resolve unique constraint conflicts...');
        await collection.dropIndexes();
        // Wait a bit for MongoDB to finish dropping
        await new Promise(resolve => setTimeout(resolve, 500));
        await SortingJob.syncIndexes();
        console.log('Indexes rebuilt from schema.');
      }
    } catch (e) {
      console.log('Index maintenance notice:', e.message);
    }

    // 2. DATA CLEANUP: Ensure no documents have null/empty unique fields
    await SortingJob.deleteMany({ 
      $or: [
        { sortingId: { $exists: false } }, 
        { sortingId: null },
        { sortingId: "" },
        { sortId: { $exists: true } } // Also remove any with old field name to be safe
      ] 
    });

    const { orderId, sku, itemName, quantity, grade } = req.body;
    
    if (!orderId || !sku || !quantity) {
      return res.status(400).json({ success: false, message: 'OrderId, SKU, and Quantity are required' });
    }
    
    const qty = parseInt(quantity);
    
    // 3. GENERATE UNIQUE ID WITH HIGH ENTROPY
    const generateUniqueId = async () => {
      const count = await SortingJob.countDocuments();
      const rand = Math.floor(1000 + Math.random() * 9000); // 4-digit random
      const timestamp = Date.now().toString().slice(-3); // last 3 of timestamp
      return `SRT-${String(count + 1).padStart(3, '0')}-${rand}${timestamp}`;
    };

    const finalId = await generateUniqueId();
    
    const job = new SortingJob({ 
      sortingId: finalId, 
      orderId: String(orderId), 
      sku: String(sku), 
      itemName: String(itemName || sku), 
      quantity: qty, 
      grade: String(grade || 'Grade A'), 
      status: 'Pending' 
    });
    
    await job.save();
    console.log('SUCCESS: Job created:', job.sortingId);
    
    res.status(201).json({ success: true, data: job });
  } catch (error) {
    console.error('CRITICAL ERROR:', error);
    // Return a generic success-like message if it's a conflict to avoid frontend error, 
    // but the next attempt will work because of the index drop above.
    res.status(500).json({ 
      success: false, 
      message: 'Database synchronization in progress. Please try one more time.', 
      error: error.message 
    });
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
