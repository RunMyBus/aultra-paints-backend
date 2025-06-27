// services/transactionService.js
const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const userModel = require("../models/User");
const User = require("../models/User");
const transactionLedger = require("../models/TransactionLedger");
const { Parser } = require('json2csv');
const moment = require('moment');

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

            const { searchKey, pointsRedeemedBy, cashRedeemedBy, couponCode, showUsedCoupons, salesExecutiveMobile  } = body;

            logger.debug('Query parameters processed', {
                page,
                limit,
                skip,
                searchKey,
                salesExecutiveMobile,
                pid: process.pid
            });

            // Build query
            let query = {};
            // fixed check to display only activated coupons
            query.batchId = { $exists: true }

            // if (userId) {
            //     query.redeemedBy = userId;
            //     logger.debug('Adding userId filter', {
            //         userId,
            //         pid: process.pid
            //     });
            // }

            if (searchKey) {
                query.$or = [
                    { couponCode: parseInt(searchKey) },
                    { pointsRedeemedBy: { $regex: searchKey, $options: 'i' } },
                    { cashRedeemedBy: { $regex: searchKey, $options: 'i' } }
                ];
                logger.debug('Search query built', {
                    searchQuery: query.$or,
                    pid: process.pid
                });
            }


            if (salesExecutiveMobile) {
                const salesExecutive = await User.findOne({
                    accountType: 'Dealer',
                    salesExecutive: salesExecutiveMobile
                });
            
                // If no sales executive is found for the given mobile number
                if (!salesExecutive) {
                    const errorMessage = `Sales Executive with mobile number ${salesExecutiveMobile} not found.`;
                    
                    logger.error(errorMessage, {
                        salesExecutiveMobile,
                        pid: process.pid
                    });
            
                    throw new Error(errorMessage);
                }
            
                // Fetch the dealers assigned to this sales executive's mobile number
                const dealersAssigned = await User.find({
                    accountType: 'Dealer',
                    salesExecutive: salesExecutiveMobile
                });
            
                // If no dealers are found for the sales executive's mobile number
                if (dealersAssigned.length === 0) {
                    const errorMessage = `No dealers found for Sales Executive with mobile number ${salesExecutiveMobile}.`;
            
                    logger.error(errorMessage, {
                        salesExecutiveMobile,
                        pid: process.pid
                    });
            
                    throw new Error(errorMessage);
                }
            
                const dealerMobiles = dealersAssigned.map(dealer => dealer.mobile);
            
                const redeemedTransactions = await Transaction.find({
                    $or: [
                        { pointsRedeemedBy: { $in: dealerMobiles } },
                        { cashRedeemedBy: { $in: dealerMobiles } }
                    ]
                });
            
                // If no transactions have been redeemed by any of the dealers
                if (redeemedTransactions.length === 0) {
                    const errorMessage = `No transactions redeemed by dealers for Sales Executive mobile number ${salesExecutiveMobile}.`;
            
                    logger.error(errorMessage, {
                        salesExecutiveMobile,
                        pid: process.pid
                    });
            
                    throw new Error(errorMessage);
                }

                query.$or = [
                    { pointsRedeemedBy: { $in: dealerMobiles } },
                    { cashRedeemedBy: { $in: dealerMobiles } }
                ];
            
                logger.debug('Sales Executive filter added', {
                    salesExecutiveMobile,
                    dealerMobiles,
                    pid: process.pid
                });
            }

            if (showUsedCoupons) {
                // If showUsedCoupons is true, check if pointsRedeemedBy or cashRedeemedBy exists
                query.$or = [
                    { pointsRedeemedBy: { $exists: true } },
                    { cashRedeemedBy: { $exists: true } }
                ];
                logger.debug('Show used coupons filter added', {
                    showUsedCoupons,
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
                query.couponCode = parseInt(couponCode);
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
                        qr_code: 1,
                        isProcessed: 1,
                        createdAt: 1,
                        updatedAt: 1,
                        pointsRedeemedBy: 1,
                        cashRedeemedBy: 1,
                        pointsRedeemedAt: 1,
                        cashRedeemedAt: 1
                    }
                },
                { $sort: { createdAt: -1, _id: -1 } },
                { $skip: ((page - 1) * limit) },
                { $limit: limit },
            ];
            // Execute query
            const transactionsData = await Transaction.aggregate(querySet);

            const totalQuery = [
                { $match: query },
                { $addFields: { batchId: { $toObjectId: "$batchId" } } },
                { $lookup: { from: 'batchnumbers', localField: 'batchId', foreignField: '_id', as: 'batchData' } },
                { $match: { "batchData.0": { $exists: true } } },
                { $count: "total" }
            ];

            const totalResult = await Transaction.aggregate(totalQuery);
            const total = totalResult.length > 0 ? totalResult[0].total : 0;

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

    async exportTransactionsToCSV(body) {
        logger.info('Starting transaction export to CSV', {
            params: body,
            pid: process.pid
        });

        try {
            const { searchKey, pointsRedeemedBy, cashRedeemedBy, couponCode, showUsedCoupons, salesExecutiveMobile  } = body;

            logger.debug('Query parameters processed', {
                searchKey,
                pointsRedeemedBy,
                cashRedeemedBy,
                couponCode,
                showUsedCoupons,
                salesExecutiveMobile,
                pid: process.pid
            });

            // Build query
            let query = {};
            // fixed check to display only activated coupons
            query.batchId = { $exists: true }

            // query.$or = [
            //     { pointsRedeemedBy: { $exists: true } },
            //     { cashRedeemedBy: { $exists: true } }
            // ];

            if (searchKey) {
                query.$or = [
                    { couponCode: parseInt(searchKey) },
                    { pointsRedeemedBy: { $regex: searchKey, $options: 'i' } },
                    { cashRedeemedBy: { $regex: searchKey, $options: 'i' } }
                ];
                logger.debug('Search query built', {
                    searchQuery: query.$or,
                    pid: process.pid
                });
            }


            if (salesExecutiveMobile) {
                const salesExecutive = await User.findOne({
                    accountType: 'Dealer',
                    salesExecutive: salesExecutiveMobile
                });

                // If no sales executive is found for the given mobile number
                if (!salesExecutive) {
                    const errorMessage = `Sales Executive with mobile number ${salesExecutiveMobile} not found.`;

                    logger.error(errorMessage, {
                        salesExecutiveMobile,
                        pid: process.pid
                    });

                    throw new Error(errorMessage);
                }

                // Fetch the dealers assigned to this sales executive's mobile number
                const dealersAssigned = await User.find({
                    accountType: 'Dealer',
                    salesExecutive: salesExecutiveMobile
                });

                // If no dealers are found for the sales executive's mobile number
                if (dealersAssigned.length === 0) {
                    const errorMessage = `No dealers found for Sales Executive with mobile number ${salesExecutiveMobile}.`;

                    logger.error(errorMessage, {
                        salesExecutiveMobile,
                        pid: process.pid
                    });

                    throw new Error(errorMessage);
                }

                const dealerMobiles = dealersAssigned.map(dealer => dealer.mobile);

                const redeemedTransactions = await Transaction.find({
                    $or: [
                        { pointsRedeemedBy: { $in: dealerMobiles } },
                        { cashRedeemedBy: { $in: dealerMobiles } }
                    ]
                });

                // If no transactions have been redeemed by any of the dealers
                if (redeemedTransactions.length === 0) {
                    const errorMessage = `No transactions redeemed by dealers for Sales Executive mobile number ${salesExecutiveMobile}.`;

                    logger.error(errorMessage, {
                        salesExecutiveMobile,
                        pid: process.pid
                    });

                    throw new Error(errorMessage);
                }

                query.$or = [
                    { pointsRedeemedBy: { $in: dealerMobiles } },
                    { cashRedeemedBy: { $in: dealerMobiles } }
                ];

                logger.debug('Sales Executive filter added', {
                    salesExecutiveMobile,
                    dealerMobiles,
                    pid: process.pid
                });
            }

            if (showUsedCoupons && showUsedCoupons === 'true') {
                // If showUsedCoupons is true, check if pointsRedeemedBy or cashRedeemedBy exists
                query.$or = [
                    { pointsRedeemedBy: { $exists: true } },
                    { cashRedeemedBy: { $exists: true } }
                ];
                logger.debug('Show used coupons filter added', {
                    showUsedCoupons,
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
                query.couponCode = parseInt(couponCode);
            }

            console.log('query ------- ', query);

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
                        branchName: { $ifNull: ['$batchData.Branch', ''] },
                        batchNumber: { $ifNull: ['$batchData.BatchNumber', ''] },
                        couponCode: 1,
                        redeemablePoints: { $ifNull: ['$batchData.RedeemablePoints', ''] },
                        value: { $ifNull: ['$batchData.value', ''] },
                        createdByName: { $ifNull: ['$userData.name', ''] },
                        updatedByName: { $ifNull: ['$uploadData.name', ''] },
                        pointsRedeemedBy: 1,
                        cashRedeemedBy: 1,
                        createdAt: 1,
                        updatedAt: 1,
                        qr_code: 1,
                        upiId: 1,
                        pointsRedeemedAt: { $ifNull: ['$pointsRedeemedAt', null] },  // Added this
                        cashRedeemedAt: { $ifNull: ['$cashRedeemedAt', null] }
                    }
                },
                { $sort: { createdAt: -1, _id: -1 } },
            ];
            // Execute query
            const transactionsData = await Transaction.aggregate(querySet);

            // Format dates with AM/PM
            const formattedData = transactionsData.map(record => ({
                ...record,
                createdAt: moment(record.createdAt).format('D-M-YYYY h:mm A'),
                updatedAt: moment(record.updatedAt).format('D-M-YYYY h:mm A'),
                pointsRedeemedAt: record.pointsRedeemedAt ? moment(record.pointsRedeemedAt).format('D-M-YYYY h:mm A') : '',
                cashRedeemedAt: record.cashRedeemedAt ? moment(record.cashRedeemedAt).format('D-M-YYYY h:mm A') : '',
                batch: `${record.branchName} - ${record.batchNumber}`,
                upiId: record.upiId ? `="${record.upiId}"` : ''
            }));

            // Define CSV fields
            const fields = [
                { label: 'Coupon Code', value: 'couponCode' },
                { label: 'Batch', value: 'batch' },
                { label: 'Points', value: 'redeemablePoints' },
                { label: 'Value', value: 'value' },
                { label: 'Points Redeemed By', value: 'pointsRedeemedBy' },
                { label: 'Cash Redeemed By', value: 'cashRedeemedBy' },
                { label: 'QR Code', value: 'qr_code' },
                { label: 'Created At', value: 'createdAt' },
                { label: 'Created By', value: 'createdByName' },
                { label: 'Points Redeemed On', value: 'pointsRedeemedAt' },
                { label: 'Cash Redeemed On', value: 'cashRedeemedAt' },
                { label: 'Cash Remitted To (UPI ID)', value: 'upiId' }
            ];

            // Create CSV parser
            const parser = new Parser({ fields });

            // Convert transactions to CSV
            const csvContent = parser.parse(formattedData);

            // Create filename with timestamp
            const timestamp = moment().format('DD-MM-YYYY');
            const filename = `transactions-export-${timestamp}.csv`;

            logger.info('Successfully generated CSV content', {
                filename,
                count: formattedData.length,
                pid: process.pid
            });

            return {
                filename,
                count: formattedData.length,
                csvContent
            };

        } catch (error) {
            logger.error('Error in transaction service - export function', {
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
                        {$set: {updatedBy: req.user._id, pointsRedeemedBy: req.user.mobile, pointsRedeemedAt: new Date()} },
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
                                    }
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
                    rewardPoints: updatedTransaction.redeemablePoints,
                    couponCode: document.couponCode,
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
