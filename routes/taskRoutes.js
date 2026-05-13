import express from 'express';
import {
  getAll, getById, create, update, updateStatus,
  addComment, deleteComment, remove,
  bulkUpdateStatus, bulkDelete,
} from '../controllers/taskController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.get('/',                          getAll);
router.post('/',                         create);
router.patch('/bulk/status',             bulkUpdateStatus);
router.delete('/bulk',                   bulkDelete);

router.get('/:id',                       getById);
router.put('/:id',                       update);
router.patch('/:id/status',              updateStatus);
router.delete('/:id',                    remove);

router.post('/:id/comments',             addComment);
router.delete('/:id/comments/:commentId', deleteComment);

export default router;
