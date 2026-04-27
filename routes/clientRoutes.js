import express from 'express';
import * as clientController from '../controllers/clientController.js';

const router = express.Router();

router.post('/', clientController.createClient);        // CREATE
router.get('/', clientController.getAllClients);        // READ ALL
router.get('/:id', clientController.getClientById);     // READ ONE
router.put('/:id', clientController.updateClient);      // UPDATE
router.delete('/:id', clientController.deleteClient);   // DELETE

export default router;
