import express from 'express';
import * as grnController from '../controllers/grnController.js';

const router = express.Router();

// CRUD Operations
router.post('/', grnController.createGRN);                    // CREATE
router.get('/stats', grnController.getGRNStats);              // READ STATS — must be before /:id
router.get('/', grnController.getAllGRNs);                    // READ ALL
router.get('/:id', grnController.getGRNById);                 // READ ONE
router.put('/:id', grnController.updateGRN);                  // UPDATE
router.delete('/:id', grnController.deleteGRN);               // DELETE

export default router;
