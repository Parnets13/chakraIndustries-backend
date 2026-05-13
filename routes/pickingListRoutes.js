import express from 'express';
import {
  getAllPickingLists, getPickingListById, createPickingList,
  updatePickingList, markItemPicked, deletePickingList, getPickingStats
} from '../controllers/pickingListController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.get('/stats', getPickingStats);
router.get('/', getAllPickingLists);
router.get('/:id', getPickingListById);
router.post('/', createPickingList);
router.put('/:id', updatePickingList);
router.patch('/:id/items/:itemId/pick', markItemPicked);
router.delete('/:id', deletePickingList);

export default router;
