import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { getAll, getDashboard, getMonthlyReport, getById, create, update, remove } from '../controllers/productionController.js';

const router = express.Router();

router.use(protect);

router.get('/dashboard',      getDashboard);
router.get('/monthly-report', getMonthlyReport);
router.get('/',               getAll);
router.get('/:id',            getById);
router.post('/',              create);
router.put('/:id',            update);
router.delete('/:id',         remove);

export default router;
