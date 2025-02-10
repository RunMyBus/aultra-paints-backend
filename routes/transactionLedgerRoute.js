const express = require('express');
const router = express.Router();
const { getAllTransactions } = require('../controllers/transactionLedgerController');
const passport = require("../middleware/passport");

router.use(passport.authenticate('jwt', { session: false }));

// Get transactions from ledger
router.post('/getTransactions', getAllTransactions);

module.exports = router;
