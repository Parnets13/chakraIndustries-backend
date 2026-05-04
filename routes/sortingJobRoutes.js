import express from 'express';
import {
  getAllSortingJobs,
  getSortingJobById,
  createSortingJob,
  updateSortingJob,
  deleteSortingJob
} from '../controllers/sortingJobController.js';

const router = express.Router();

router.get('/', getAllSortingJobs);
router.get('/:id', getSortingJobById);
router.post('/', createSortingJob);
router.put('/:id', updateSortingJob);
router.delete('/:id', deleteSortingJob);

export default router;
