const express = require('express');
const router = express.Router();
const districtController = require('../controllers/districtController');

// Create district
router.post('/', districtController.createDistrict);

// Get all districts
router.get('/all', districtController.getAllDistricts);



module.exports = router;
