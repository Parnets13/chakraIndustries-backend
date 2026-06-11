import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  upload,
  uploadStatement,
  getStatements,
  getStatementById,
  reconcileStatement
} from '../controllers/brsController.js';

const router = express.Router();
router.use(protect);

// Upload bank statement
router.post('/upload', upload.single('file'), uploadStatement);

// Get all statements
router.get('/', getStatements);

// Get statement by ID
router.get('/:id', getStatementById);

// Reconcile statement
router.post('/:id/reconcile', reconcileStatement);

export default router;
