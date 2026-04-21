const Transaction = require('../models/Transaction');
const Batch = require("../models/batchnumber");
const User = require('../models/User');
const sequenceModel = require("../models/sequence.model");
const {ObjectId} = require("mongodb");
const userModel = require("../models/User");
const transactionLedger = require("../models/TransactionLedger");
const logger = require('../utils/logger'); // Import the configured logger
const transactionService = require('../services/transactionService');

exports.getAllTransactions = async (req, res) => {

    logger.info('Starting getAllTransactionsForBatch request', {
        page: req.body.page,
        limit: req.body.limit,
        userId: req.body.userId,
        pid: process.pid
    });
    try {
        const result = await transactionService.getTransactions(req.body);
        res.status(200).json(result);
    } catch  (error) {
        logger.error('Error in getAllTransactionsForBatch', {
            error: error.message,
            stack: error.stack,
            pid: process.pid
        });

        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching transactions',
            error: error.message
        });
    }
};

exports.exportTransactions = async (req, res) => {
    try {
        const result = await transactionService.exportTransactionsToCSV(req.body);

        // Set appropriate headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${result.filename}`);

        // Send the CSV content directly
        res.send(result.csvContent);
    } catch (error) {
        logger.error('Error in exportTransactions', {
            error: error.message,
            stack: error.stack,
            pid: process.pid
        });

        return res.status(400).json({
            status: 'error',
            message: error.message
        });
    }
};

exports.markTransactionAsProcessed = async (req, res) => {
    const { qr } = req.params;

    try {
        // Atomic claim: only succeeds if pointsRedeemedBy is not already set.
        // This single operation replaces the previous check-then-update pattern,
        // closing a race where two concurrent scans could both redeem a coupon.
        const claimed = await Transaction.findOneAndUpdate(
            { UDID: qr, pointsRedeemedBy: { $exists: false } },
            {
                $set: {
                    updatedBy: req.user._id,
                    pointsRedeemedBy: req.user.mobile,
                    pointsRedeemedAt: new Date(),
                },
            },
            { new: true }
        );

        if (!claimed) {
            // Distinguish "not found" from "already redeemed" without leaking timing.
            const existing = await Transaction.findOne({ UDID: qr }).select('_id pointsRedeemedBy');
            if (!existing) return res.status(404).json({ message: 'Coupon not found.' });
            return res.status(409).json({ message: 'Coupon Redeemed already.' });
        }

        const rewardPointsCount = claimed.redeemablePoints || 0;
        const userData = await User.findOneAndUpdate(
            { _id: claimed.updatedBy },
            { $inc: { rewardPoints: rewardPointsCount } },
            { new: true }
        );

        if (!userData) {
            logger.error('Redeeming user not found after atomic claim; rolling back', {
                transactionId: claimed._id,
                userId: claimed.updatedBy,
            });
            // Best-effort rollback so the coupon can be re-redeemed.
            await Transaction.updateOne(
                { _id: claimed._id },
                { $unset: { pointsRedeemedBy: '', pointsRedeemedAt: '', updatedBy: '' } }
            );
            return res.status(404).json({ message: 'User not found for update.' });
        }

        await transactionLedger.create({
            narration: `Scanned coupon ${claimed.couponCode} and redeemed points.`,
            amount: `+ ${claimed.redeemablePoints}`,
            balance: userData.rewardPoints,
            userId: userData._id,
            couponId: claimed._id,
        });

        return res.status(200).json({
            message: 'Coupon redeemed Successfully..!',
            data: { rewardPoints: claimed.redeemablePoints, couponCode: claimed.couponCode },
        });
    } catch (error) {
        logger.error('Error in markTransactionAsProcessed', { error: error.message });
        return res.status(500).json({ error: 'Failed to redeem coupon.' });
    }
};

exports.redeemPoints = async (req, res) => {
    logger.info('Starting redeemPoints request', {
        body: req.body,
    });
    try {
        return await transactionService.redeemCouponPoints(req, res);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: error.message });
    }
};
