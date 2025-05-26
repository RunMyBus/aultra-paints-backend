const express = require('express');
const router = express.Router();
const passport = require("../middleware/passport");
const chartController = require('../controllers/chartController');

router.use(passport.authenticate('jwt', { session: false }));

// Get batch statistics for bar chart
router.get('/batch-statistics', chartController.getBatchStatistics);

router.post('/batch-statistics-list', chartController.getBatchStatisticsList);

// Get timeline data for a specific batch
router.get('/batch-timeline', chartController.getMonthlyBatchStatistics);

router.post('/export-batch-statistics', chartController.exportBatchStatistics);

module.exports = router;
