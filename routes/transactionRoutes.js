const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const passport = require('../middleware/passport');

router.use(passport.authenticate('jwt', { session: false }));

// Existing route to get all transactions for a batch
router.post('/', transactionController.getAllTransactionsForBatch);

// New route to mark transaction as processed
router.patch('/mark-processed/:qr', transactionController.markTransactionAsProcessed);

router.post('/redeemPoints', transactionController.redeemPoints);

module.exports = router;
