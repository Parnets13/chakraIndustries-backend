import express from 'express';
import { getAll, create, updateStatus, remove } from '../controllers/taskController.js';

const router = express.Router();
router.get('/', getAll);
router.post('/', create);
router.patch('/:id/status', updateStatus);
router.delete('/:id', remove);
export default router;
