const Transaction = require('../models/Transaction');
const Batch = require("../models/batchnumber");
const User = require('../models/User');
const sequenceModel = require("../models/sequence.model");
const {ObjectId} = require("mongodb");
const userModel = require("../models/User");
const transactionLedger = require("../models/TransactionLedger");
const logger = require('../utils/logger'); // Import the configured logger
const transactionService = require('../services/transactionService');

exports.getAllTransactionsForBatch = async (req, res) => {

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

exports.markTransactionAsProcessed = async (req, res) => {
    const { qr } = req.params;  // Assuming qr is passed as a URL parameter

    try {
        const document = await Transaction.findOne({ UDID:  qr });
        if (!document) {
            return res.status(404).json({ message: 'Coupon not found.' })
        }
        if(document.pointsRedeemedBy !== undefined) {
            return res.status(404).json({ message: 'Coupon Redeemed already.' });
        } else {
            const staticUserData = await userModel.findOne({mobile: '9999999998'});
            let userId = req.user._id.toString();
            let updatedTransaction = {};
            if (userId === staticUserData._id.toString()) {
                updatedTransaction = await Transaction.findOneAndUpdate(
                    {UDID: qr},  // Match the QR code
                    {updatedBy: req.user._id },
                    {new: true}  // Return the updated document
                );
                updatedTransaction.pointsRedeemedBy = staticUserData.mobile;
            }else {
                // Find the transaction and update isProcessed to true
                updatedTransaction = await Transaction.findOneAndUpdate(
                    {UDID: qr},  // Match the QR code
                    {updatedBy: req.user._id, pointsRedeemedBy: req.user.mobile },
                    {new: true}  // Return the updated document
                );
            }
            let userData = {};
            if (updatedTransaction.pointsRedeemedBy !== undefined) {
                const rewardPointsCount = updatedTransaction.redeemablePoints || 0;
                // Update the user fields safely
                userData = await User.findOneAndUpdate(
                    { _id: updatedTransaction.updatedBy },
                    [
                        {
                            $set: {
                                rewardPoints: {
                                    $add: [{ $ifNull: ["$rewardPoints", 0] }, rewardPointsCount],
                                }/*,
                                cash: {
                                    $add: [{ $ifNull: ["$cash", 0] }, cashCount],
                                }*/
                            }
                        }
                    ],
                    { new: true } // Return the updated document
                );

                if (!userData) {
                    return res.status(404).json({ message: 'User not found for update.' });
                }
            }

            if (!updatedTransaction) {
                return res.status(404).json({message: 'Transaction not found.'});
            }

            const data = {
                rewardPoints: updatedTransaction.redeemablePoints,
                couponCode: document.couponCode
            }

            await transactionLedger.create({
                narration: `Scanned coupon ${updatedTransaction.couponCode} and redeemed points.`,
                amount: `+ ${updatedTransaction.redeemablePoints}`,
                balance: userData.rewardPoints,
                userId: userData._id,
                couponId: updatedTransaction._id
            });

            return res.status(200).json({message: "Coupon redeemed Successfully..!", data: data});
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: error.message });
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
