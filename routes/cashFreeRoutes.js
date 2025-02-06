const express = require('express');
const router = express.Router();
const cashFreePaymentService = require('../services/cashFreePaymentService');
const { getAllTransactions } = require('../controllers/cashFreeController');
const passport = require("../middleware/passport");

// Test Payment Processing Endpoint
router.post('/testPayment', async (req, res) => {
    try {
        const { mobile, name, cash } = req.body;
        const paymentResult = await cashFreePaymentService.pay2Phone(mobile, name, cash);
        if (paymentResult.success) {
            res.status(200).json({ success: true, message: paymentResult.message });
        } else {
            res.status(400).json({ success: false, message: paymentResult.message, data: paymentResult.data });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.use(passport.authenticate('jwt', { session: false }));

// Get all cash free transactions
router.get('/getTransactions', getAllTransactions);

module.exports = router;
