const userModel = require("../models/User");

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
            await userModel.updateOne(
                { _id: loggedInUser._id },
                { $inc: { rewardPoints: -rewardPoints } }
            );
            // Add points to dealer
            await userModel.updateOne(
                { _id: dealer._id },
                { $inc: { rewardPoints: rewardPoints } }
            );
            return res({status: 200, message: 'Reward points transferred successfully'});
        } catch (transactionError) {
            throw transactionError;
        }
    } catch (error) {
        console.error('Error transferring reward points:', error.message);
        return res({status: 500, error: error.message});
    }
}