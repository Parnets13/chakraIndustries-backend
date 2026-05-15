import express from 'express';
import { getAll, getById, create, update, remove, addMaintenanceLog, getSummary } from '../controllers/assetController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

// Static routes MUST come before /:id to avoid being swallowed
router.get('/stats/summary',    getSummary);
router.get('/',                 getAll);
router.post('/',                create);
router.get('/:id',              getById);
router.put('/:id',              update);
router.delete('/:id',           remove);
router.post('/:id/maintenance', addMaintenanceLog);

export default router;
