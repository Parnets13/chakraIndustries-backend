import express from 'express';
import { getDepartments, createDepartment, deleteDepartment } from '../controllers/departmentController.js';

const router = express.Router();

router.get('/', getDepartments);
router.post('/', createDepartment);
router.delete('/:id', deleteDepartment);

export default router;
