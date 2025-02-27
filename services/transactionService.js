// services/transactionService.js
const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const userModel = require("../models/User");
const User = require("../models/User");
const transactionLedger = require("../models/TransactionLedger");

class TransactionService {
    async getTransactions(body) {
        //const requestId = new mongoose.Types.ObjectId();
        logger.info('Starting transaction service fetch', {
            params: body,
            pid: process.pid
        });

        try {
            const page = parseInt(body.page || 1);
            const limit = parseInt(body.limit || 10);
            const skip = (page - 1) * limit;

            const { userId, search, pointsRedeemedBy, cashRedeemedBy, couponCode } = body;

            logger.debug('Query parameters processed', {
                page,
                limit,
                skip,
                search,
                pid: process.pid
            });

            // Build query
            let query = {};
            // fixed check to display only activated coupons
            query.batchId = { $exists: true }

            if (userId) {
                query.redeemedBy = userId;
                logger.debug('Adding userId filter', {
                    userId,
                    pid: process.pid
                });
            }

            if (search) {
                query.$or = [
                    { couponCode: parseInt(search) },
                    { pointsRedeemedBy: { $regex: search, $options: 'i' } },
                    { cashRedeemedBy: { $regex: search, $options: 'i' } }
                ];
                logger.debug('Search query built', {
                    searchQuery: query.$or,
                    pid: process.pid
                });
            }

            if (pointsRedeemedBy) {
                query.pointsRedeemedBy = { $regex: pointsRedeemedBy, $options: 'i' };
            }

            if (cashRedeemedBy) {
                query.cashRedeemedBy = { $regex: cashRedeemedBy, $options: 'i' };
            }

            if (couponCode) {
                query.couponCode = couponCode;
            }

            let querySet = [
                { $match: query },
                { $addFields: { batchId: { $toObjectId: "$batchId" } } },
                { $lookup: { from: 'batchnumbers', localField: 'batchId', foreignField: '_id', as: 'batchData' } },
                { $unwind: '$batchData' },

                { $addFields: { createdBy: { $toObjectId: "$createdBy" } } },
                { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'userData' } },
                { $unwind: '$userData' },

                // { $addFields: { updatedBy: { $toObjectId: "$updatedBy" } } },
                { $addFields: { updatedBy: { $cond: { if: { $eq: ["$updatedBy", null] }, then: null, else: { $toObjectId: "$updatedBy" } } } } },
                { $lookup: { from: 'users', localField: 'updatedBy', foreignField: '_id', as: 'uploadData' } },
                { $unwind: { path: '$uploadData', preserveNullAndEmptyArrays: true } },

                { $addFields: { redeemedBy: { $cond: { if: { $eq: ["$redeemedBy", null] }, then: null, else: { $toObjectId: "$redeemedBy" } } } } },
                { $lookup: { from: 'users', localField: 'redeemedBy', foreignField: '_id', as: 'redeemedData' } },
                { $unwind: { path: '$redeemedData', preserveNullAndEmptyArrays: true } },

                {
                    $project: {
                        _id: 1,
                        transactionId: 1,
                        batchId: 1,
                        branchName: { $ifNull: ['$batchData.Branch', ''] },
                        batchNumber: { $ifNull: ['$batchData.BatchNumber', ''] },
                        couponCode: 1,
                        redeemablePoints: { $ifNull: ['$batchData.RedeemablePoints', ''] },
                        value: { $ifNull: ['$batchData.value', ''] },
                        createdByName: { $ifNull: ['$userData.name', ''] },
                        updatedByName: { $ifNull: ['$uploadData.name', ''] },
                        createdBy: 1,
                        updatedBy: 1,
                        qr_code_id: 1,
                        qr_code: 1,
                        couponValue: 1,
                        points: 1,
                        redeemedBy: 1,
                        redeemedByName:  { $ifNull: ['$redeemedData.name', ''] },
                        redeemedByMobile: { $ifNull: ['$redeemedData.mobile', ''] },
                        isProcessed: 1,
                        createdAt: 1,
                        updatedAt: 1,
                        pointsRedeemedBy: 1,
                        cashRedeemedBy: 1
                    }
                },
                { $sort: { createdAt: -1, _id: -1 } },
                { $skip: ((page - 1) * limit) },
                { $limit: limit },
            ];
            // Execute query
            const transactionsData = await Transaction.aggregate(querySet);

            const total = await Transaction.countDocuments(query);

            logger.info('Successfully retrieved transactions', {
                count: transactionsData.length,
                total,
                pid: process.pid
            });

            return {
                total: total,
                pages: Math.ceil(total / limit),
                currentPage: page,
                transactionsData
            }

        } catch (error) {
            logger.error('Error in transaction service', {
                error: error.message,
                stack: error.stack,
                pid: process.pid
            });

            throw error;
        }
    }

    async extractValueFromUrl(qrCodeUrl) {
        try {
            const url = new URL(qrCodeUrl); // Parse the URL
            const pathname = url.pathname; // Extract the pathname
            const searchParams = url.searchParams; // Extract query parameters
            // Check if query parameters are present (e.g., ?uid=...)
            if (searchParams.toString()) {
                for (const value of searchParams.values()) {
                    return value; // Return the first value dynamically
                }
            }
            // If no query parameters, extract the last part of the pathname
            const parts = pathname.split('/').filter(part => part); // Split path and remove empty parts
            const lastSegment = parts[parts.length - 1];

            // If the last segment has a key-value pair format (e.g., `key=value`), return the value
            if (lastSegment.includes('=')) {
                const [, value] = lastSegment.split('=');
                return value;
            }
            // If it's just an ID or other value, return it directly
            return lastSegment;
        } catch (error) {
            logger.error('Error in transaction service; extractValueFromUrl method - Invalid URL', {
                qrCodeUrl: qrCodeUrl,
                error: error.message,
                stack: error.stack,
                pid: process.pid
            });
            //console.error('Invalid URL:', qrCodeUrl, error);
            return null;
        }
    };

    async redeemCouponPoints(req, res) {
        const { qrCodeUrl } = req.body;  // Assuming qr is passed as a URL parameter

        const qr = await this.extractValueFromUrl(qrCodeUrl);

        logger.debug('Successfully extracted udid from qr code', {
            udid: qr,
        });

        try {
            const document = await Transaction.findOne({ UDID:  qr });
            if (!document) {
                logger.warn('Coupon not found', {
                    udid: qr,
                });
                return res.status(404).json({ message: 'Coupon not found.' })
            }
            logger.debug('Successfully retrieved coupon based on udid', {
                couponCode: document.couponCode,
            });
            if(document.pointsRedeemedBy !== undefined) {
                logger.warn('Coupon Redeemed already', {
                    couponCode: document.couponCode,
                });
                return res.status(404).json({ message: 'Coupon Redeemed already.' });
            } else {
                const staticUserData = await userModel.findOne({mobile: '9999999998'});
                let userId = req.user._id.toString();
                let updatedTransaction = {};
                if (userId === staticUserData._id.toString()) {
                    logger.info('Static user logged in, so making the qr redeemable again', {
                        userId: userId,
                    });
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
                    logger.info('Successfully updated coupon', {
                        pointsRedeemedBy: updatedTransaction.pointsRedeemedBy
                    });
                }
                let userData = {};
                if (updatedTransaction.pointsRedeemedBy !== undefined) {
                    // let getTransaction = await Transaction.findOne({couponCode: qr})
                    // batch = await Batch.findOne({_id: getTransaction.batchId});
                    // if (getTransaction) {
                    const rewardPointsCount = updatedTransaction.redeemablePoints || 0;
                    // const cashCount = updatedTransaction.value || 0;

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
                        logger.warn('User not found for updating points', {
                            userId: userData._id
                        });
                        return res.status(404).json({ message: 'User not found for update.' });
                    }
                    logger.info('Successfully updated points to user', {
                        userId: userData._id,
                        pointsRedeemed: rewardPointsCount
                    });
                    // }
                }

                if (!updatedTransaction) {
                    return res.status(404).json({message: 'Transaction not found.'});
                }

                const data = {
                    // qr_code_id: updatedTransaction.qr_code_id,
                    // isProcessed: updatedTransaction.isProcessed,
                    rewardPoints: updatedTransaction.redeemablePoints,
                    couponCode: document.couponCode,
                    // cash: updatedTransaction.value,
                    // brachName: batch.Branch,
                    // batchNumber: batch.BatchNumber,
                }

                await transactionLedger.create({
                    narration: `Scanned coupon ${updatedTransaction.couponCode} and redeemed points.`,
                    amount: updatedTransaction.redeemablePoints,
                    balance: userData.rewardPoints,
                    userId: userData._id
                });

                logger.info('Coupon redeemed successfully and logged to ledger');

                return res.status(200).json({message: "Coupon redeemed Successfully..!", data: data});
            }
        } catch (error) {
            logger.error('Error in transaction service - redeemCouponPoints method', {
                error: error.message,
                stack: error.stack,
                pid: process.pid
            });
            //console.log(error);
            return res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new TransactionService();
