const express = require('express');
const router = express.Router();
const stateController = require('../controllers/stateController');

// Create state
router.post('/', stateController.createState);

// Get all states
router.get('/all', stateController.getStates);



module.exports = router;
