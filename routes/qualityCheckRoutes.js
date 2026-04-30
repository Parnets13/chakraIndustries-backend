import express from 'express';
import * as qcController from '../controllers/qualityCheckController.js';

const router = express.Router();

// CRUD Operations
router.post('/', qcController.createQualityCheck);                    // CREATE
router.get('/', qcController.getAllQualityChecks);                    // READ ALL
router.get('/stats', qcController.getQCStats);                        // READ STATS
router.get('/:id', qcController.getQualityCheckById);                 // READ ONE
router.put('/:id/status', qcController.updateQualityCheckStatus);     // UPDATE STATUS
router.delete('/:id', qcController.deleteQualityCheck);               // DELETE

export default router;
