const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const CashFreeTransaction = require('../models/CashFreeTransaction');
const BulkPePaymentService = require("../services/bulkPePaymentService");

async function processPayload(payload) {
    // Validate required fields
    if (!payload?.data?.reference_id) {
        logger.error('Webhook missing reference_id', payload);
    }

    const refId = payload.data.reference_id;

    // Find existing transaction by transfer_id
    const transaction = await CashFreeTransaction.findOne({ transfer_id: refId });

    if (!transaction) {
        logger.warn(`No transaction found for reference_id: ${refId}. Creating fallback record.`);

        // Create fallback if not found, so it’s trackable
        const fallback = new CashFreeTransaction({
            transfer_id: refId,
            cf_transfer_id: payload.data?.transcation_id || payload.data?.transaction_id || '',
            status: payload.data?.trx_status || '',
            status_code: payload.data?.trx_message.toString() || '',
            status_description: payload.data?.trx_message || payload?.message || '',
            beneficiary_details: {
                beneCode: '',
                beneName: payload.data?.beneficiaryName || '',
                beneAccNum: payload.data?.account_number || '',
                beneIfscCode: payload.data?.ifsc || '',
                beneAcType: ''
            },
            transfer_amount: payload.data?.amount || 0,
            transfer_mode: payload.data?.payment_mode || 'UPI',
            transfer_utr: payload.data?.utr || '',
            added_on: payload.data?.createdAt || new Date().toISOString(),
            updated_on: payload.data?.updatedAt || new Date().toISOString(),
            event_time: new Date().toISOString(),
            event_type: payload.data?.type || 'Debit'
        });

        await fallback.save();
        return;
    }

    // Update the transaction
    transaction.cf_transfer_id = payload.data?.transcation_id || transaction.cf_transfer_id;
    transaction.status = payload.data?.trx_status || transaction.status;
    transaction.status_code = payload.data?.trx_message?.toString() || transaction.status_code || '';
    transaction.status_description = payload.data?.trx_message || payload?.message || transaction.status_description;
    transaction.beneficiary_details = {
        ...transaction.beneficiary_details,
        beneName: payload.data?.beneficiaryName || transaction.beneficiary_details?.beneName,
        beneAccNum: payload.data?.account_number || transaction.beneficiary_details?.beneAccNum,
        beneIfscCode: payload.data?.ifsc || transaction.beneficiary_details?.beneIfscCode,
    };
    transaction.transfer_amount = payload.data?.amount || transaction.transfer_amount;
    transaction.transfer_mode = payload.data?.payment_mode || transaction.transfer_mode;
    transaction.transfer_utr = payload.data?.utr || transaction.transfer_utr;
    transaction.updated_on = payload.data?.updatedAt || new Date().toISOString();
    transaction.event_time = new Date().toISOString();
    transaction.event_type = 'WEBHOOK_UPDATE';

    await transaction.save();

    logger.info(`Transaction updated for reference_id: ${refId}`, {
        status: transaction.status,
        utr: transaction.transfer_utr
    });
}

router.post('/webhooks/receive/success', async (req, res) => {
    try {
        logger.info('webhook headers', { headers: req.headers });
        logger.info('Received webhook payload', { body: req.body });

        processPayload(req.body);

        return res.status(200).json({ message: 'Transaction updated successfully.' });
    } catch (error) {
        logger.error('Error processing webhook', { error: error.message, body: req.body });

        return res.status(500).json({
            message: 'Internal Server Error while processing webhook'
        });
    }
});

router.post('/testUPIPayment', async (req, res) => {
    try {
        const { upi, name, cash } = req.body;
        const paymentResult = await BulkPePaymentService.upiPayment(upi, name, cash);
        if (paymentResult.success) {
            res.status(200).json({ success: true, message: paymentResult.message });
        } else {
            res.status(400).json({ success: false, message: paymentResult.message, data: paymentResult.data });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
