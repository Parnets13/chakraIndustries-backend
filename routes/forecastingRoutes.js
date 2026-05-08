import express from 'express';
import { getDemandForecast, getSkuForecast, getSuggestedPurchases, getInventoryOptimization, getSeasonalConfig, saveSeasonalConfig, autoGeneratePOs } from '../controllers/forecastingController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.get('/demand', protect, getDemandForecast);
router.get('/sku', protect, getSkuForecast);
router.get('/suggested-purchases', protect, getSuggestedPurchases);
router.get('/optimization', protect, getInventoryOptimization);
router.get('/seasonal', protect, getSeasonalConfig);
router.post('/seasonal', protect, saveSeasonalConfig);
router.post('/auto-generate-pos', protect, autoGeneratePOs);
export default router;
