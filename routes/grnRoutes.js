import express from 'express';
import * as grnController from '../controllers/grnController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.post('/', grnController.createGRN);
router.get('/stats', grnController.getGRNStats);
router.get('/', grnController.getAllGRNs);
router.get('/:id', grnController.getGRNById);
router.put('/:id', grnController.updateGRN);
router.delete('/:id', grnController.deleteGRN);

export default router;
