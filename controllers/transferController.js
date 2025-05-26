const userModel = require("../models/User");
const transactionLedger = require("../models/TransactionLedger");

exports.transferPoints = async (req, res) => {
    const { rewardPoints } = req.body;
    const loggedInUser = req.user;
    try {
        // Ensure rewardPoints is a positive number
        if (!rewardPoints || rewardPoints <= 0) {
            return res({status: 400, error: 'Invalid reward points'});
        }

        let recipientUser;
        let narrationFrom;
        let narrationTo;

        // Handle different transfer scenarios based on account type
        if (loggedInUser.accountType === 'Painter') {
            // Painter to Dealer transfer logic
            recipientUser = await userModel.findOne({ dealerCode: loggedInUser.parentDealerCode });
            if (!recipientUser) {
                return res({status: 404, error: 'Dealer not found'});
            }
            narrationFrom = 'Transferred reward points to dealer';
            narrationTo = 'Received reward points from painter';
        } 
        else if (loggedInUser.accountType === 'Dealer') {
            // Dealer to Super User transfer logic
            const superUserMobile = process.env.SUPER_USER_MOBILE;
            if (!superUserMobile) {
                return res({status: 400, error: 'Super User mobile not configured'});
            }

            recipientUser = await userModel.findOne({ 
                mobile: superUserMobile,
                accountType: 'SuperUser'
            });
            
            if (!recipientUser) {
                return res({status: 404, error: 'Super User not found'});
            }
            narrationFrom = 'Transferred reward points to Super User';
            narrationTo = 'Received reward points from dealer';
        }
        else {
            return res({status: 403, error: 'Unauthorized, either painters and dealers can transfer points'});
        }

        // Check if sender has enough reward points to transfer
        if (loggedInUser.rewardPoints < rewardPoints) {
            return res({status: 400, error: 'Insufficient reward points'});
        }

        // Perform the transfer
        try {
            // Deduct points from sender
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

            // Add points to recipient
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

            // Add transactions to the ledger
            await transactionLedger.create({
                narration: narrationFrom,
                amount: `- ${rewardPoints}`,
                balance: savedSenderData.rewardPoints,
                userId: savedSenderData._id
            });

            await transactionLedger.create({
                narration: narrationTo,
                amount: `+ ${rewardPoints}`,
                balance: savedRecipientData.rewardPoints,
                userId: savedRecipientData._id
            });

            return res({status: 200, message: 'Reward points transferred successfully'});
        } catch (transactionError) {
            throw transactionError;
        }
    } catch (error) {
        console.error('Error transferring reward points:', error.message);
        return res({status: 500, error: error.message});
    }
}
