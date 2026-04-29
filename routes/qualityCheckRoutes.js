import express from 'express';
import { getAllQC, getQCStats, getQCById, submitQC } from '../controllers/qualityCheckController.js';

const router = express.Router();

router.get('/stats', getQCStats);
router.get('/', getAllQC);
router.get('/:id', getQCById);
router.patch('/:id/submit', submitQC);

export default router;
