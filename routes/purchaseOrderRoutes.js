import express from 'express';
import { getAllPOs, getPOById, createPO, updatePO, updatePOStatus, deletePO, bulkUploadPOs } from '../controllers/purchaseOrderController.js';
import { protect } from '../middleware/authMiddleware.js';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
router.use(protect);

router.get('/', getAllPOs);
router.get('/:id', getPOById);
router.post('/', createPO);
router.post('/bulk-upload', upload.single('file'), bulkUploadPOs);
router.put('/:id', updatePO);
router.patch('/:id/status', updatePOStatus);
router.delete('/:id', deletePO);

export default router;
