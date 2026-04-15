import express from 'express';
import * as rfqController from '../controllers/rfqController.js';

const router = express.Router();

// CRUD Operations
router.post('/', rfqController.createRFQ);                    // CREATE
router.get('/', rfqController.getAllRFQs);                    // READ ALL
router.get('/stats', rfqController.getRFQStats);              // READ STATS
router.get('/:id', rfqController.getRFQById);                 // READ ONE
router.put('/:id', rfqController.updateRFQ);                  // UPDATE
router.patch('/:id/status', rfqController.updateRFQStatus);   // UPDATE STATUS
router.delete('/:id', rfqController.deleteRFQ);               // DELETE

export default router;
