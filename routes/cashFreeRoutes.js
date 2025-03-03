const express = require('express');
const router = express.Router();
const cashFreePaymentService = require('../services/cashFreePaymentService');
const { getAllTransactions } = require('../controllers/cashFreeController');
const passport = require("../middleware/passport");
const Cashfree = require('../utils/Cashfree');
const CashFreeTransaction = require('../models/CashFreeTransaction');
const logger = require('../utils/logger');
const bodyParser = require('body-parser');

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

router.post('/testUPIPayment', async (req, res) => {
    try {
        const { upi, mobile, cash } = req.body;
        const paymentResult = await cashFreePaymentService.upiPayment(upi, mobile, cash);
        if (paymentResult.success) {
            res.status(200).json({ success: true, message: paymentResult.message });
        } else {
            res.status(400).json({ success: false, message: paymentResult.message, data: paymentResult.data });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Custom middleware to capture raw body before JSON parsing
const rawBodyMiddleware = (req, res, buf, encoding) => {
    req.rawBody = buf.toString();
    console.log('raw body ----- ', req.rawBody);// Store exact raw body
};

router.post('/webhooks/receive',
    bodyParser.json({ verify: rawBodyMiddleware }),
    async (req, res) => {
    try {
        console.log('Received webhooks events response --- ', req.body);
        console.log('Received webhooks events response raw --- ', req.rawBody);
        //req.rawBody = req.body.toString();
        const signature = req.header('x-webhook-signature') ? req.header('x-webhook-signature') : req.body.signature;
        const rawBody = JSON.stringify(req.body);
        const timestamp = req.header('x-webhook-timestamp') ? req.header('x-webhook-timestamp') : req.body.alertTime;

        const PayoutWebhookEvent =  Cashfree.PayoutVerifyWebhookSignature(signature, rawBody, timestamp);
        logger.info('PayoutWebhookEvent --- ', PayoutWebhookEvent);
        const eventData = PayoutWebhookEvent.object.data;
        const eventTime = PayoutWebhookEvent.object.event_time;
        const eventType = PayoutWebhookEvent.object.type;
        const cashFreeTransaction = await CashFreeTransaction.findOneAndUpdate(
            {
                transfer_id: eventData.transfer_id,
                cf_transfer_id: eventData.cf_transfer_id
            },{
                $set: {
                    status: eventData.status,
                    status_code: eventData.status_code,
                    status_description: eventData.status_description,
                    transfer_service_charge: eventData.transfer_service_charge ? eventData.transfer_service_charge : null,
                    transfer_service_tax: eventData.transfer_service_tax ? eventData.transfer_service_tax : null,
                    transfer_utr: eventData.transfer_utr ? eventData.transfer_utr : null,
                    fundsource_id: eventData.fundsource_id ? eventData.fundsource_id : null,
                    added_on: eventData.added_on,
                    updated_on: eventData.updated_on,
                    event_time: eventTime,
                    event_type: eventType
                }
            }
        );
    } catch (error) {
        console.error('Error while receiving webhooks events from CashFree --- ', error);
    } finally {
        return res.status(200).json({message: 'Webhook received.'});
    }
});

router.use(passport.authenticate('jwt', { session: false }));

// Get all cash free transactions
router.get('/getTransactions', getAllTransactions);

module.exports = router;
