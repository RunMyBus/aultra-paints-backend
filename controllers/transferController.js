const userModel = require("../models/User");
const transactionLedger = require("../models/TransactionLedger");
const transactionLedgerService = require("../services/transactionLedgerService");
const logger = require("../utils/logger");


exports.transferPoints = async (req, res) => {
    const { rewardPoints } = req.body;
    const loggedInUser = req.user;

    logger.info('=== TRANSFER POINTS REQUEST STARTED ===');
    logger.info('Timestamp:', { timestamp: new Date().toISOString() });
    logger.info('Sender Details:', {
        userId: loggedInUser._id,
        name: loggedInUser.name,
        mobile: loggedInUser.mobile,
        accountType: loggedInUser.accountType,
        currentBalance: loggedInUser.rewardPoints,
        dealerCode: loggedInUser.dealerCode,
        parentDealerCode: loggedInUser.parentDealerCode
    });
    logger.info('Transfer Amount:', { rewardPoints });

    try {
        // Ensure rewardPoints is a positive number
        if (!rewardPoints || rewardPoints <= 0) {
            logger.warn('Validation Failed: Invalid reward points', { rewardPoints });
            return res({status: 400, error: 'Invalid reward points'});
        }
        logger.info('Validation Passed: Reward points are valid');

        let recipientUser;
        let narrationFrom;
        let narrationTo;
        let uniqueCode;

        // Handle different transfer scenarios based on account type
        logger.info('\n--- Determining Transfer Type ---');
        if (loggedInUser.accountType === 'Painter') {
            logger.info('Transfer Type: Painter → Dealer');
            logger.info('Looking for dealer with dealerCode:', { dealerCode: loggedInUser.parentDealerCode });

            // Painter to Dealer transfer logic
            recipientUser = await userModel.findOne({ dealerCode: loggedInUser.parentDealerCode });

            if (!recipientUser) {
                logger.error('Error: Dealer not found for dealerCode:', { dealerCode: loggedInUser.parentDealerCode });
                return res({status: 404, error: 'Dealer not found'});
            }

            logger.info('Dealer Found:', {
                userId: recipientUser._id,
                name: recipientUser.name,
                mobile: recipientUser.mobile,
                currentBalance: recipientUser.rewardPoints
            });

            narrationFrom = 'Transferred reward points to dealer';
            narrationTo = 'Received reward points from painter';
        }
        else if (loggedInUser.accountType === 'Dealer') {
            logger.info('Transfer Type: Dealer → SuperUser');

            // Dealer to Super User transfer logic
            const superUserMobile = process.env.SUPER_USER_MOBILE;
            logger.info('SuperUser Mobile from ENV:', { superUserMobile });

            if (!superUserMobile) {
                logger.error('Error: Super User mobile not configured in environment');
                return res({status: 400, error: 'Super User mobile not configured'});
            }

            // Check transfer rule: at least 1000 and only multiples of 1000
            logger.info('Checking dealer transfer rules (min 1000, multiples of 1000)...');
            if (rewardPoints < 1000 || rewardPoints % 1000 !== 0) {
                logger.warn('Validation Failed: Invalid transfer amount', { rewardPoints });
                return res({
                    status: 400,
                    error: 'Invalid transfer amount. Dealers can transfer reward points only in multiples of 1000, with a minimum of 1000 points per transfer.',
                });
            }
            logger.info('Transfer amount validation passed');

            logger.info('Looking for SuperUser with mobile:', { superUserMobile });
            recipientUser = await userModel.findOne({
                mobile: superUserMobile,
                accountType: 'SuperUser'
            });

            if (!recipientUser) {
                logger.error('Error: Super User not found with mobile:', { superUserMobile });
                return res({status: 404, error: 'Super User not found'});
            }

            logger.info('SuperUser Found:', {
                userId: recipientUser._id,
                name: recipientUser.name,
                mobile: recipientUser.mobile,
                currentBalance: recipientUser.rewardPoints
            });

            narrationFrom = 'Transferred reward points to Super User';
            narrationTo = 'Received reward points from dealer';

            // Generate unique code only for Dealer → SuperUser transfer
            logger.info('Generating unique ledger code...');
            uniqueCode = await transactionLedgerService.generateLedgerCode(loggedInUser._id);
            logger.info('Generated uniqueCode:', { uniqueCode });
        }
        else {
            logger.error('Error: Unauthorized account type', { accountType: loggedInUser.accountType });
            return res({status: 403, error: 'Unauthorized, either painters and dealers can transfer points'});
        }

        // Check if sender has enough reward points to transfer
        logger.info('\n--- Balance Validation ---');
        logger.info('Sender Balance:', {
            senderBalance: loggedInUser.rewardPoints,
            required: rewardPoints
        });

        if (loggedInUser.rewardPoints < rewardPoints) {
            logger.warn('Error: Insufficient balance');
            return res({status: 400, error: 'Insufficient reward points'});
        }
        logger.info('Sufficient balance available');

        // Perform the transfer
        logger.info('\n--- Starting Database Transaction ---');
        try {
            // Deduct points from sender
            logger.info('Step 1: Deducting points from sender...');
            logger.info('Updating userId:', {
                userId: loggedInUser._id,
                deducting: rewardPoints
            });

            const savedSenderData = await userModel.findOneAndUpdate(
                { _id: loggedInUser._id },
                [
                    {
                        $set: {
                            rewardPoints: {
                                $subtract: [{ $ifNull: ["$rewardPoints", 0] }, rewardPoints],
                            }
                        }
                    }
                ]
            ,{ new: true });

            logger.info('Sender updated successfully. New balance:', {
                newBalance: savedSenderData.rewardPoints
            });

            // Add points to recipient
            logger.info('Step 2: Adding points to recipient...');
            logger.info('Updating userId:', {
                userId: recipientUser._id,
                adding: rewardPoints
            });
            const savedRecipientData = await userModel.findOneAndUpdate(
                { _id: recipientUser._id },
                [
                    {
                        $set: {
                            rewardPoints: {
                                $add: [{ $ifNull: ["$rewardPoints", 0] }, rewardPoints],
                            }
                        }
                    }
                ]
            ,{ new: true });

            logger.info('Recipient updated successfully. New balance:', {
                newBalance: savedRecipientData.rewardPoints
            });

            // Add transactions to the ledger
            logger.info('Step 3: Creating sender ledger entry...');
            const senderLedgerData = {
                narration: narrationFrom,
                amount: `- ${rewardPoints}`,
                balance: savedSenderData.rewardPoints,
                userId: savedSenderData._id,
                ...(uniqueCode ? { uniqueCode } : {})
            };
            logger.info('Sender Ledger Data:', senderLedgerData);

            await transactionLedger.create(senderLedgerData);
            logger.info('Sender ledger entry created successfully');

            logger.info('Step 4: Creating recipient ledger entry...');
            const recipientLedgerData = {
                narration: narrationTo,
                amount: `+ ${rewardPoints}`,
                balance: savedRecipientData.rewardPoints,
                userId: savedRecipientData._id,
                ...(uniqueCode ? { uniqueCode } : {})
            };
            logger.info('Recipient Ledger Data:', recipientLedgerData);

            await transactionLedger.create(recipientLedgerData);
            logger.info('Recipient ledger entry created successfully');

            logger.info('\n=== TRANSFER COMPLETED SUCCESSFULLY ===');
            logger.info('Summary:', {
                senderNewBalance: savedSenderData.rewardPoints,
                recipientNewBalance: savedRecipientData.rewardPoints,
                amountTransferred: rewardPoints,
                uniqueCode: uniqueCode || 'N/A'
            });

            return res({status: 200, message: 'Reward points transferred successfully'});
        } catch (transactionError) {
            logger.error('\nTRANSACTION ERROR OCCURRED');
            logger.error('Transaction Error Details:', {
                message: transactionError.message,
                name: transactionError.name,
                code: transactionError.code,
                stack: transactionError.stack
            });
            throw transactionError;
        }
    } catch (error) {
        logger.error('\nTRANSFER FAILED');
        logger.error('Error Type:', { errorName: error.name });
        logger.error('Error Message:', { errorMessage: error.message });
        logger.error('Error Code:', { errorCode: error.code });
        logger.error('Full Error Stack:', { stack: error.stack });

        if (error.code === 11000) {
            logger.error('DUPLICATE KEY ERROR - uniqueCode collision detected');
            logger.error('Duplicate Key Details:', { keyValue: error.keyValue });
        }

        return res({status: 400, error: error.message});
    }
}