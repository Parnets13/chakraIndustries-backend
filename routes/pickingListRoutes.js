import express from 'express';
import {
  getAllPickingLists,
  getPickingListById,
  createPickingList,
  updatePickingList,
  markItemPicked,
  deletePickingList
} from '../controllers/pickingListController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, getAllPickingLists);
router.get('/:id', protect, getPickingListById);
router.post('/', protect, createPickingList);
router.put('/:id', protect, updatePickingList);
router.patch('/:id/items/:itemId/pick', protect, markItemPicked);
router.delete('/:id', protect, deletePickingList);

export default router;
