import express from 'express';
import {
  getVehicles, createVehicle, updateVehicle, deleteVehicle,
  getDispatches, getDispatchStats, createDispatch, updateDispatchStatus, deleteDispatch,
  getShipments, createShipment, updateShipment, markPOD, deleteShipment,
} from '../controllers/logisticsController.js';

const router = express.Router();

// Vehicles
router.get('/vehicles', getVehicles);
router.post('/vehicles', createVehicle);
router.put('/vehicles/:id', updateVehicle);
router.delete('/vehicles/:id', deleteVehicle);

// Dispatches
router.get('/dispatches', getDispatches);
router.get('/dispatches/stats', getDispatchStats);
router.post('/dispatches', createDispatch);
router.patch('/dispatches/:id/status', updateDispatchStatus);
router.delete('/dispatches/:id', deleteDispatch);

// Courier Shipments
router.get('/shipments', getShipments);
router.post('/shipments', createShipment);
router.put('/shipments/:id', updateShipment);
router.patch('/shipments/:id/pod', markPOD);
router.delete('/shipments/:id', deleteShipment);

export default router;
