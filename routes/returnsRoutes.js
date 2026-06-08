/**
 * /api/returns — thin alias that delegates to materialReturnController.
 * The primary endpoint is /api/material-returns; this route exists for
 * any legacy or convenience calls to /api/returns.
 */
import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getAll,
  getStats,
  create,
  updateStage,
  remove,
} from '../controllers/materialReturnController.js';

const router = express.Router();
router.use(protect);

router.get('/stats', getStats);
router.get('/', getAll);
router.post('/', create);
router.patch('/:id/stage', updateStage);
router.delete('/:id', remove);

export default router;
