const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

// Existing route to get all transactions for a batch
router.get('/:batchId', transactionController.getAllTransactionsForBatch);

// New route to mark transaction as processed
router.patch('/mark-processed/:qr', transactionController.markTransactionAsProcessed);

module.exports = router;