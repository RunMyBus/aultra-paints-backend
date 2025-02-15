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
        // Check if logged-in user is a painter
        if (loggedInUser.accountType !== 'Painter') {
            return res({status: 403, error: 'Only painters can transfer reward points'});
        }
        // Find the dealer using the painter's parentDealerCode
        const dealer = await userModel.findOne({ dealerCode: loggedInUser.parentDealerCode });
        if (!dealer) {
            return res({status: 404, error: 'Dealer not found'});
        }
        // Check if the painter has enough reward points to transfer
        if (loggedInUser.rewardPoints < rewardPoints) {
            return res({status: 400, error: 'Insufficient reward points'});
        }
        // Perform the transfer: deduct from painter and add to dealer
        try {
            // Deduct points from painter
            const savedUserData = await userModel.findOneAndUpdate(
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
            // Add points to dealer
            const savedDealerData = await userModel.findOneAndUpdate(
                { _id: dealer._id },
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
                narration: 'Transferred reward points to dealer',
                amount: `- ${rewardPoints}`,
                balance: savedUserData.rewardPoints,
                userId: savedUserData._id
            });
            await transactionLedger.create({
                narration: 'Received reward points from painter',
                amount: `+ ${rewardPoints}`,
                balance: savedDealerData.rewardPoints,
                userId: savedDealerData._id
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