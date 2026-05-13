import express from 'express';
import {
  getVehicles, createVehicle, updateVehicle, deleteVehicle,
  getDispatches, getDispatchStats, createDispatch, updateDispatchStatus, deleteDispatch,
  getShipments, createShipment, updateShipment, markPOD, deleteShipment,
  trackCourier, regularizeDispatch, getPendencyReport,
} from '../controllers/logisticsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

// Vehicles
router.get('/vehicles', getVehicles);
router.post('/vehicles', createVehicle);
router.put('/vehicles/:id', updateVehicle);
router.delete('/vehicles/:id', deleteVehicle);

// Dispatches
router.get('/dispatches/stats', getDispatchStats);
router.get('/dispatches', getDispatches);
router.post('/dispatches', createDispatch);
router.patch('/dispatches/:id/status', updateDispatchStatus);
router.delete('/dispatches/:id', deleteDispatch);

// Courier Shipments
router.get('/shipments', getShipments);
router.post('/shipments', createShipment);
router.put('/shipments/:id', updateShipment);
router.patch('/shipments/:id/pod', markPOD);
router.delete('/shipments/:id', deleteShipment);

// Courier Tracking & Reports
router.get('/track/:awbNo', trackCourier);
router.post('/dispatches/:id/regularize', regularizeDispatch);
router.get('/pendency', getPendencyReport);

export default router;
