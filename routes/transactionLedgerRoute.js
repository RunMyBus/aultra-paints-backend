const express = require('express');
const router = express.Router();
const { getAllTransactions, generateTransactionLedgerTemplate } = require('../controllers/transactionLedgerController');
const passport = require("../middleware/passport");

router.use(passport.authenticate('jwt', { session: false }));

// Get transactions from ledger
router.post('/getTransactions', getAllTransactions);

router.get('/credit-note/:transactionLedgerId',  generateTransactionLedgerTemplate);

module.exports = router;
