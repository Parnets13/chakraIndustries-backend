import express from 'express';
import * as creditNoteController from '../controllers/creditNoteController.js';

const router = express.Router();

// CRUD Operations
router.post('/', creditNoteController.createCreditNote);                    // CREATE
router.get('/', creditNoteController.getAllCreditNotes);                    // READ ALL
router.get('/stats', creditNoteController.getCreditNoteStats);              // READ STATS
router.get('/overdue', creditNoteController.getOverdueCreditNotes);         // READ OVERDUE
router.get('/:id', creditNoteController.getCreditNoteById);                 // READ ONE
router.put('/:id', creditNoteController.updateCreditNote);                  // UPDATE
router.patch('/:id/status', creditNoteController.updateCreditNoteStatus);   // UPDATE STATUS
router.post('/:id/send-reminder', creditNoteController.sendReminder);       // SEND REMINDER
router.delete('/:id', creditNoteController.deleteCreditNote);               // DELETE

export default router;
