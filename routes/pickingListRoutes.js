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

router.get('/', getAllPickingLists);
router.get('/:id', getPickingListById);
router.post('/', createPickingList);
router.put('/:id', updatePickingList);
router.patch('/:id/items/:itemId/pick', markItemPicked);
router.delete('/:id', deletePickingList);

export default router;
