const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');


router.get('/', transactionController.getAllTransactionsForBatch );

module.exports = router;
