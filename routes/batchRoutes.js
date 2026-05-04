import express from 'express';
import {
  getAllBatches,
  getBatchById,
  createBatch,
  updateBatch,
  deleteBatch
} from '../controllers/batchController.js';

const router = express.Router();

// Add comprehensive logging middleware
router.use((req, res, next) => {
  console.log(`\n[BATCH ROUTE] ${req.method} ${req.path}`);
  console.log('  Query:', JSON.stringify(req.query));
  console.log('  Body:', req.body ? JSON.stringify(req.body).substring(0, 100) : 'none');
  
  // Wrap res.json to log responses
  const originalJson = res.json;
  res.json = function(data) {
    console.log('  Response:', data.success ? '✓ Success' : '✗ Error', data.message || '');
    return originalJson.call(this, data);
  };
  
  next();
});

router.get('/', getAllBatches);
router.get('/:id', getBatchById);
router.post('/', createBatch);
router.put('/:id', updateBatch);
router.delete('/:id', deleteBatch);

export default router;
