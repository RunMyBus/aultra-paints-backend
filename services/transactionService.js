// services/transactionService.js
const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

class TransactionService {
    async getTransactions(params) {
        const requestId = new mongoose.Types.ObjectId();
        logger.info('Starting transaction service fetch', {
            requestId,
            params,
            pid: process.pid
        });

        try {
            const page = parseInt(params.page || 1);
            const limit = parseInt(params.limit || 10);
            const skip = (page - 1) * limit;

            const { userId, search, pointsRedeemedBy, cashRedeemedBy, couponCode } = params;

            logger.debug('Query parameters processed', {
                requestId,
                page,
                limit,
                skip,
                search,
                pid: process.pid
            });

            // Build query
            let query = {};

            if (userId) {
                query.redeemedBy = userId;
                logger.debug('Adding userId filter', {
                    requestId,
                    userId,
                    pid: process.pid
                });
            }

            if (search) {
                query.$or = [
                    { couponCode: parseInt(search) }
                    // Add other search conditions as needed
                ];
                logger.debug('Search query built', {
                    requestId,
                    searchQuery: query.$or,
                    pid: process.pid
                });
            }

            if (pointsRedeemedBy) {
                query.pointsRedeemedBy = pointsRedeemedBy;
            }

            if (cashRedeemedBy) {
                query.cashRedeemedBy = cashRedeemedBy;
            }

            if (couponCode) {
                query.couponCode = couponCode;
            }

            // Execute query
            const transactions = await Transaction.find(query)
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 });

            const total = await Transaction.countDocuments(query);

            logger.info('Successfully retrieved transactions', {
                requestId,
                count: transactions.length,
                total,
                pid: process.pid
            });

            return {
                success: true,
                data: transactions,
                pagination: {
                    page,
                    limit,
                    total
                }
            };

        } catch (error) {
            logger.error('Error in transaction service', {
                requestId,
                error: error.message,
                stack: error.stack,
                pid: process.pid
            });

            throw error;
        }
    }
}

module.exports = new TransactionService();
