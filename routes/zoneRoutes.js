const express = require('express');
const router = express.Router();
const zoneController = require('../controllers/zoneController');

// Create zone
router.post('/', zoneController.createZone);

// Get all zones
router.get('/all', zoneController.getAllZones);



module.exports = router;
