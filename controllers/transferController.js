const userModel = require("../models/User");
const transactionLedger = require("../models/TransactionLedger");
const transactionLedgerService = require("../services/transactionLedgerService");
const logger = require("../utils/logger");
const { isPositiveInteger } = require('../utils/validators');


exports.transferPoints = async (req, res) => {
    const { rewardPoints } = req.body;
    const loggedInUser = req.user;

    logger.info('Transfer points request', {
        senderId: loggedInUser._id,
        senderAccountType: loggedInUser.accountType,
        rewardPoints
    });

    try {
        if (!isPositiveInteger(Number(rewardPoints))) {
            return res({ status: 400, error: 'Invalid reward points' });
        }
        const amount = Number(rewardPoints);

        let recipientUser;
        let narrationFrom;
        let narrationTo;
        let uniqueCode;

        if (loggedInUser.accountType === 'Painter') {
            if (!loggedInUser.parentDealerCode) {
                return res({ status: 400, error: 'Painter has no parent dealer configured' });
            }
            recipientUser = await userModel.findOne({
                dealerCode: loggedInUser.parentDealerCode,
                accountType: 'Dealer',
                status: { $ne: 'inactive' }
            });
            if (!recipientUser) return res({ status: 404, error: 'Dealer not found' });
            narrationFrom = 'Transferred reward points to dealer';
            narrationTo = 'Received reward points from painter';
        }
        else if (loggedInUser.accountType === 'Dealer') {
            const superUserMobile = process.env.SUPER_USER_MOBILE;
            if (!superUserMobile) {
                return res({ status: 400, error: 'Super User mobile not configured' });
            }
            if (amount < 1000 || amount % 1000 !== 0) {
                return res({
                    status: 400,
                    error: 'Dealers can transfer reward points only in multiples of 1000, minimum 1000 per transfer.',
                });
            }
            recipientUser = await userModel.findOne({
                mobile: superUserMobile,
                accountType: 'SuperUser'
            });
            if (!recipientUser) return res({ status: 404, error: 'Super User not found' });
            narrationFrom = 'Transferred reward points to Super User';
            narrationTo = 'Received reward points from dealer';
            uniqueCode = await transactionLedgerService.generateLedgerCode(loggedInUser._id);
        }
        else {
            return res({ status: 403, error: 'Unauthorized, only painters and dealers can transfer points' });
        }

        // Atomic debit: only succeeds if the sender currently has >= amount.
        // Replaces the prior read-then-update pattern that allowed overdraft.
        const savedSenderData = await userModel.findOneAndUpdate(
            { _id: loggedInUser._id, rewardPoints: { $gte: amount } },
            { $inc: { rewardPoints: -amount } },
            { new: true }
        );
        if (!savedSenderData) {
            return res({ status: 400, error: 'Insufficient reward points' });
        }

        let savedRecipientData;
        try {
            savedRecipientData = await userModel.findOneAndUpdate(
                { _id: recipientUser._id },
                { $inc: { rewardPoints: amount } },
                { new: true }
            );
            if (!savedRecipientData) throw new Error('Recipient update returned null');
        } catch (creditErr) {
            logger.error('Credit leg failed; refunding sender', {
                senderId: loggedInUser._id,
                amount,
                error: creditErr.message
            });
            await userModel.updateOne(
                { _id: loggedInUser._id },
                { $inc: { rewardPoints: amount } }
            );
            return res({ status: 500, error: 'Transfer failed; balance restored.' });
        }

        try {
            await transactionLedger.create({
                narration: narrationFrom,
                pointsCredited: `- ${amount}`,
                pointsBalance: savedSenderData.rewardPoints,
                userId: savedSenderData._id,
                ...(uniqueCode ? { uniqueCode } : {})
            });
            await transactionLedger.create({
                narration: narrationTo,
                pointsCredited: `+ ${amount}`,
                pointsBalance: savedRecipientData.rewardPoints,
                userId: savedRecipientData._id,
                ...(uniqueCode ? { uniqueCode } : {})
            });
        } catch (ledgerErr) {
            // Balances are committed; ledger inconsistency is logged for manual reconcile.
            logger.error('Ledger write failed after successful balance move', {
                senderId: loggedInUser._id,
                recipientId: recipientUser._id,
                amount,
                uniqueCode,
                error: ledgerErr.message
            });
        }

        return res({ status: 200, message: 'Reward points transferred successfully' });
    } catch (error) {
        logger.error('Transfer failed', { error: error.message });
        if (error.code === 11000) {
            logger.error('Duplicate key on uniqueCode', { keyValue: error.keyValue });
        }
        return res({ status: 400, error: error.message });
    }
}