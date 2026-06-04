// services/transactionService.js
const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const User = require("../models/User");
const transactionLedger = require("../models/TransactionLedger");
const { Parser } = require('json2csv');
const moment = require('moment');
const { escapeRegex, clampLimit, clampPage } = require('../utils/validators');
const { getDealerAccountId } = require('./focus8Order.service');
const redeemEligibleAccountTypes = (config.POINTS_REDEEM_ELIGIBLE_ACCOUNT_TYPES || 'Dealer').split(',').map(t => t.trim());

class TransactionService {
    async getTransactions(body) {
        //const requestId = new mongoose.Types.ObjectId();
        logger.info('Starting transaction service fetch', {
            params: body,
            pid: process.pid
        });

        try {
            const page = clampPage(body.page);
            const limit = clampLimit(body.limit);
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
                const safeKey = escapeRegex(String(searchKey));
                query.$or = [
                    { couponCode: parseInt(searchKey) },
                    { UDID: { $regex: safeKey, $options: 'i' } },
                    { pointsRedeemedBy: { $regex: safeKey, $options: 'i' } },
                    { cashRedeemedBy: { $regex: safeKey, $options: 'i' } }
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
                // Must not overwrite an existing $or (e.g. from searchKey).
                // Use $and to combine both conditions.
                const usedFilter = [
                    { pointsRedeemedBy: { $exists: true } },
                    { cashRedeemedBy: { $exists: true } }
                ];
                if (query.$or) {
                    query.$and = [{ $or: query.$or }, { $or: usedFilter }];
                    delete query.$or;
                } else {
                    query.$or = usedFilter;
                }
                logger.debug('Show used coupons filter added', {
                    showUsedCoupons,
                    pid: process.pid
                });
            }

            
            if (pointsRedeemedBy) {
                query.pointsRedeemedBy = { $regex: escapeRegex(String(pointsRedeemedBy)), $options: 'i' };
            }

            if (cashRedeemedBy) {
                query.cashRedeemedBy = { $regex: escapeRegex(String(cashRedeemedBy)), $options: 'i' };
            }

            if (couponCode) {
                query.couponCode = parseInt(couponCode);
            }

            // Sort and paginate BEFORE lookups so we only join the current page's rows.
            let querySet = [
                { $match: query },
                { $sort: { createdAt: -1, _id: -1 } },
                { $skip: skip },
                { $limit: limit },

                { $addFields: { batchId: { $toObjectId: "$batchId" } } },
                { $lookup: { from: 'batchnumbers', localField: 'batchId', foreignField: '_id', as: 'batchData' } },
                { $unwind: '$batchData' },

                { $addFields: { createdBy: { $toObjectId: "$createdBy" } } },
                { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'userData' } },
                { $unwind: '$userData' },

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
                        UDID: 1,
                        createdAt: 1,
                        updatedAt: 1,
                        pointsRedeemedBy: 1,
                        cashRedeemedBy: 1,
                        pointsRedeemedAt: 1,
                        cashRedeemedAt: 1
                    }
                },
            ];

            // Count query needs no $lookup — just match and count.
            const totalQuery = [
                { $match: query },
                { $count: "total" }
            ];

            // Run data and count in parallel.
            const [transactionsData, totalResult] = await Promise.all([
                Transaction.aggregate(querySet),
                Transaction.aggregate(totalQuery),
            ]);

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
                const safeKey = escapeRegex(String(searchKey));
                query.$or = [
                    { couponCode: parseInt(searchKey) },
                    { UDID: { $regex: safeKey, $options: 'i' } },
                    { pointsRedeemedBy: { $regex: safeKey, $options: 'i' } },
                    { cashRedeemedBy: { $regex: safeKey, $options: 'i' } }
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
                // Must not overwrite an existing $or (e.g. from searchKey).
                // Use $and to combine both conditions.
                const usedFilter = [
                    { pointsRedeemedBy: { $exists: true } },
                    { cashRedeemedBy: { $exists: true } }
                ];
                if (query.$or) {
                    query.$and = [{ $or: query.$or }, { $or: usedFilter }];
                    delete query.$or;
                } else {
                    query.$or = usedFilter;
                }
                logger.debug('Show used coupons filter added', {
                    showUsedCoupons,
                    pid: process.pid
                });
            }


            if (pointsRedeemedBy) {
                query.pointsRedeemedBy = { $regex: escapeRegex(String(pointsRedeemedBy)), $options: 'i' };
            }

            if (cashRedeemedBy) {
                query.cashRedeemedBy = { $regex: escapeRegex(String(cashRedeemedBy)), $options: 'i' };
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
        // Dealers redeem both points and cash; Painters redeem points only.
        if (!redeemEligibleAccountTypes.includes(req.user.accountType)) {
            return res.status(403).json({ message: `Only ${redeemEligibleAccountTypes.join(', ')} are eligible to redeem points.` });
        }

        const isPainter = req.user.accountType === 'Painter';

        if (isPainter) {
            // Painters are authorized via their parent dealer's Focus8 account
            if (!req.user.parentDealerCode) {
                return res.status(403).json({ message: 'Parent dealer code not set. Contact support.' });
            }
            const focusAccountId = await getDealerAccountId(req.user.parentDealerCode);
            if (!focusAccountId) {
                return res.status(403).json({ message: 'Parent dealer not found in Focus8. Contact support.' });
            }
        } else {
            // Dealers must be directly registered in Focus8
            if (!req.user.dealerCode) {
                return res.status(403).json({ message: 'Dealer code not set. Contact support.' });
            }
            const focusAccountId = await getDealerAccountId(req.user.dealerCode);
            if (!focusAccountId) {
                return res.status(403).json({ message: 'Dealer not found in Focus8. Contact support.' });
            }
        }

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

            // Each coupon has two independent reward tracks: a points reward
            // (redeemablePoints) tracked by `pointsRedeemedBy`, and a cash
            // reward (`value`) tracked by `cashRedeemedBy`. After cash payouts
            // via payment gateway were retired, the cash value is now also
            // credited to the user's `rewardPoints` balance — but each track
            // is still redeemed independently, so a partially-redeemed coupon
            // (e.g. cash already taken via the old flow but points untouched)
            // can be completed by a later scan.
            //
            // Refuse the scan only when BOTH tracks have already been redeemed.
            const pointsAlreadyRedeemed = document.pointsRedeemedBy !== undefined;
            const cashAlreadyRedeemed   = document.cashRedeemedBy   !== undefined;

            // Painters only get the points track, so the coupon is exhausted for them
            // as soon as points are taken. Dealers need both tracks used.
            const allTracksRedeemed = isPainter
                ? pointsAlreadyRedeemed
                : (pointsAlreadyRedeemed && cashAlreadyRedeemed);

            if (allTracksRedeemed) {
                logger.warn('Coupon already redeemed', {
                    couponCode: document.couponCode,
                    isPainter,
                    pointsRedeemedBy: document.pointsRedeemedBy,
                    cashRedeemedBy: document.cashRedeemedBy,
                });
                return res.status(404).json({ message: 'Coupon Redeemed already.' });
            }

            const now = new Date();

            // Build the $set update with only the fields for the tracks we are
            // redeeming on this scan. Skip tracks already redeemed earlier.
            const updateSet = { updatedBy: req.user._id };
            if (!pointsAlreadyRedeemed) {
                updateSet.pointsRedeemedBy = req.user.mobile;
                updateSet.pointsRedeemedAt = now;
            }
            // Painters never redeem cash
            if (!isPainter && !cashAlreadyRedeemed) {
                updateSet.cashRedeemedBy = req.user.mobile;
                updateSet.cashRedeemedAt = now;
            }

            const updatedTransaction = await Transaction.findOneAndUpdate(
                { UDID: qr },
                { $set: updateSet },
                { new: true }
            );
            logger.info('Successfully updated coupon — redeemed tracks', {
                couponCode: updatedTransaction && updatedTransaction.couponCode,
                pointsRedeemedNow: !pointsAlreadyRedeemed,
                cashRedeemedNow: !isPainter && !cashAlreadyRedeemed,
            });

            if (!updatedTransaction) {
                return res.status(404).json({ message: 'Transaction not found.' });
            }

            // Credit each unredeemed track to its own balance on the User:
            //   coupon.redeemablePoints → User.rewardPoints
            //   coupon.value             → User.cash
            // Tracks already redeemed earlier stay at 0 and are not double-credited.
            const pointsReward = pointsAlreadyRedeemed ? 0 : (updatedTransaction.redeemablePoints || 0);
            // Painters only get points; cash is skipped for them entirely
            const cashReward = (!isPainter && !cashAlreadyRedeemed) ? (updatedTransaction.value || 0) : 0;

            let userData = req.user;
            if (pointsReward > 0 || cashReward > 0) {
                const inc = {};
                if (pointsReward > 0) inc.rewardPoints = pointsReward;
                if (cashReward   > 0) inc.cash         = cashReward;

                userData = await User.findOneAndUpdate(
                    { _id: updatedTransaction.updatedBy },
                    { $inc: inc },
                    { new: true }
                );

                if (!userData) {
                    logger.warn('User not found for updating points/cash', {
                        userId: updatedTransaction.updatedBy,
                    });
                    return res.status(404).json({ message: 'User not found for update.' });
                }
                logger.info('Successfully credited coupon to user', {
                    userId: userData._id,
                    pointsReward,
                    cashReward,
                    rewardPoints: userData.rewardPoints,
                    cash: userData.cash,
                });
            }

            // One ledger row per scan, carrying both tracks in their own
            // fields. `amount`/`balance` cover the points side (historical
            // meaning); `cashReward`/`cashBalance` cover the cash side.
            if (pointsReward > 0 || cashReward > 0) {
                const narrationParts = [];
                if (pointsReward > 0) narrationParts.push(`${pointsReward} pts`);
                if (cashReward   > 0) narrationParts.push(`${cashReward} cash`);
                const narration = `Scanned coupon ${updatedTransaction.couponCode}: ${narrationParts.join(' + ')} credited.`;

                await transactionLedger.create({
                    narration,
                    pointsCredited: pointsReward,
                    pointsBalance:  userData.rewardPoints,
                    cashReward,
                    cashBalance:    userData.cash,
                    userId:         userData._id,
                });
            }

            logger.info('Coupon redeemed successfully and logged to ledger', {
                pointsReward,
                cashReward,
            });

            // Response carries each track's credit independently. Callers
            // (mobile, web) decide how to render the split.
            const data = {
                rewardPoints: pointsReward,
                cashReward,
                couponCode: document.couponCode,
            };

            return res.status(200).json({ message: "Coupon redeemed Successfully..!", data: data });
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
