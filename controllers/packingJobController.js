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
    console.log('--- START CREATE PACKING JOB ---');
    
    // 1. FORCE INDEX CLEANUP
    try {
      const collection = PackingJob.collection;
      const indexes = await collection.indexes();
      if (indexes.length > 1) {
        console.log('Dropping all indexes for packing to resolve conflicts...');
        await collection.dropIndexes();
        await new Promise(resolve => setTimeout(resolve, 500));
        await PackingJob.syncIndexes();
        console.log('Packing indexes rebuilt.');
      }
    } catch (e) {
      console.log('Packing index maintenance notice:', e.message);
    }

    // 2. DATA CLEANUP
    await PackingJob.deleteMany({ 
      $or: [
        { packId: { $exists: false } }, 
        { packId: null },
        { packId: "" }
      ] 
    });

    const { orderId, items, weight, boxType } = req.body;
    
    if (!orderId || items === undefined) {
      return res.status(400).json({ success: false, message: 'OrderId and Items are required' });
    }
    
    const itemCount = parseInt(items);
    
    // 3. GENERATE UNIQUE ID
    const generateUniqueId = async () => {
      const count = await PackingJob.countDocuments();
      const rand = Math.floor(1000 + Math.random() * 9000);
      const timestamp = Date.now().toString().slice(-3);
      return `PKG-${String(count + 1).padStart(3, '0')}-${rand}${timestamp}`;
    };

    const finalId = await generateUniqueId();
    
    const job = new PackingJob({ 
      packId: finalId, 
      orderId: String(orderId), 
      items: itemCount, 
      weight: String(weight || '0'), 
      boxType: String(boxType || 'Standard Box'), 
      status: 'Pending' 
    });
    
    await job.save();
    console.log('SUCCESS: Packing job created:', job.packId);
    
    res.status(201).json({ success: true, data: job });
  } catch (error) {
    console.error('CRITICAL ERROR:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Database synchronization in progress. Please try one more time.', 
      error: error.message 
    });
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
