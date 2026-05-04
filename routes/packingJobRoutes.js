import express from 'express';
import {
  getAllPackingJobs,
  getPackingJobById,
  createPackingJob,
  updatePackingJob,
  deletePackingJob
} from '../controllers/packingJobController.js';

const router = express.Router();

router.get('/', getAllPackingJobs);
router.get('/:id', getPackingJobById);
router.post('/', createPackingJob);
router.put('/:id', updatePackingJob);
router.delete('/:id', deletePackingJob);

export default router;
