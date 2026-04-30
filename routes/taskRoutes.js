import express from 'express';
import {
  getAll, getById, create, update, updateStatus,
  addComment, deleteComment, remove,
  bulkUpdateStatus, bulkDelete,
} from '../controllers/taskController.js';

const router = express.Router();

// Collection
router.get('/',                          getAll);
router.post('/',                         create);
router.patch('/bulk/status',             bulkUpdateStatus);
router.delete('/bulk',                   bulkDelete);

// Single task
router.get('/:id',                       getById);
router.put('/:id',                       update);
router.patch('/:id/status',              updateStatus);
router.delete('/:id',                    remove);

// Comments
router.post('/:id/comments',             addComment);
router.delete('/:id/comments/:commentId', deleteComment);

export default router;
