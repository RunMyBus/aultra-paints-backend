const userModel = require('../models/User');
const bcrypt = require("bcryptjs");
const { ObjectId } = require('mongodb');
const Transaction = require('../models/Transaction');
const redeemedUserModel = require("../models/redeemedUser.model");

exports.getAll = async (body, res) => {
    try {
        let data = await userModel.find();
        return res({status: 200, data});
    } catch (err) {
        return res({status: 500, message: "Something went wrong"});
    }
}

exports.searchUser = async (body, res) => {
    try {
        let page = parseInt(body.page || 1);
        let limit = parseInt(body.limit || 10);
        let query = {};
        if (body.searchQuery) {
            query['$or'] = [
                {'name': {$regex: new RegExp(body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
                {'mobile': {$regex: new RegExp(body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
                {'email': {$regex: new RegExp(body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
            ]
        }
        let data = await userModel.find(query, {password: 0}).skip((page - 1) * limit).limit(parseInt(limit));
        const totalUsers = await userModel.countDocuments(query);
        return res({status: 200, data, total: totalUsers, pages: Math.ceil(totalUsers / limit), currentPage: page});
        // return res({status: 200, data});
    } catch (err) {
        return res({status: 500, message: "Something went wrong"});
    }
}

exports.addUser = async (body, res) => {
    try {
        let errorArray = [];
        if (body.mobile) {
            const oldMobile = await userModel.findOne({
                mobile: {$regex: new RegExp(`^${body.mobile.trim()}$`), "$options": "i"}
            });
            if (oldMobile)
                errorArray.push('Mobile already exists');
        } else {
            errorArray.push('Enter mobile number');
        }

        if (body.accountType && body.accountType.toLowerCase() === 'dealer') {
            if (!body.primaryContactPerson) {
                errorArray.push('Primary contact person is required for dealers');
            }
            if (!body.primaryContactPersonMobile) {
                errorArray.push('Primary contact person mobile is required for dealers');
            }
            if (!body.dealerCode) {
                errorArray.push('Dealer code is required for dealers');
            } else {
                const oldDealerCode = await userModel.findOne({
                    dealerCode: {
                        $regex: new RegExp(`^${body.dealerCode.trim()}$`),
                        "$options": "i"
                    }
                });
                if (body.dealerCode!== undefined && oldDealerCode!== null && oldDealerCode._id.toString()!== id) {
                    errorArray.push('Dealer code already exists');
                }
            }
            // if (!body.parentDealer) {
            //     errorArray.push('Parent dealer is required for dealers');
            // }
            if (!body.address) {
                errorArray.push('Address is required for dealers');
            }
        }

        if (errorArray.length) {
            return res({ status: 400, errors: errorArray })
        }

        body.password = await bcrypt.hash(body.password, 10);

        let userData = await userModel.insertMany(body);
        return res({status: 200, message: userData});
    } catch (err) {
        console.log(err);
        return res({status: 500, message: err.message});
    }
}

exports.userUpdate = async (id, body, res) => {
    try {
        let errorArray = [];
        if (body.mobile) {
            const oldMobile = await userModel.findOne({
                mobile: {
                    $regex: new RegExp(`^${body.mobile.trim()}$`),
                    "$options": "i"
                }
            });
            if (body.mobile !== undefined && oldMobile !== null && oldMobile._id.toString() !== id) {
                errorArray.push('Mobile already exists');
                // return res({ status: 400, message: 'Mobile already exists' });
            }
        } else {
            errorArray.push('Enter mobile number');
        }
        if (body.accountType && body.accountType.toLowerCase() === 'dealer') {
            if (!body.primaryContactPerson) {
                errorArray.push('Primary contact person is required for dealers');
            }
            if (!body.primaryContactPersonMobile) {
                errorArray.push('Primary contact person mobile is required for dealers');
            }
            if (!body.dealerCode) {
                errorArray.push('Dealer code is required for dealers');
            } else {
                const oldDealerCode = await userModel.findOne({
                    dealerCode: {
                        $regex: new RegExp(`^${body.dealerCode.trim()}$`),
                        "$options": "i"
                    }
                });
                if (body.dealerCode!== undefined && oldDealerCode!== null && oldDealerCode._id.toString()!== id) {
                    errorArray.push('Dealer code already exists');
                    // return res({ status: 400, message: 'Dealer code already exists' });
                }
            }
            // if (!body.parentDealer) {
            //     errorArray.push('Parent dealer is required for dealers');
            // }
            if (!body.address) {
                errorArray.push('Address is required for dealers');
            }
        }

        if (errorArray.length > 0) {
            return res({ status: 400, errors: errorArray, })
        }
        let user = await userModel.updateOne({ _id: new ObjectId(id) }, { $set: body });
        return res({ status: 200, message: user });
    } catch (err) {
        console.log(err)
        return res({ status: 500, message: err });
    }
}

exports.getUser = async (id, res) => {
    try {
        const data = await userModel.findOne({_id: new ObjectId(id)}, {password: 0, token: 0});
        data.rewards = [
            {"title": "Redeemed Points", "description": "Redeemed Points Confirmation", "count": data.redeemedPoints},
            {"title": "Earned Cash Reward", "description": "Earned Cash Reward Confirmation", "count": data.cash},
        ];
        return res({status: 200, data: data})
    } catch (err) {
        return res({status: 500, message: err})
    }
}

exports.deleteUser = async (id, res) => {
    try {
        const data = await userModel.deleteOne({_id: new ObjectId(id)});
        return res({status: 200, data: data})
    } catch (err) {
        return res({status: 500, message: err})
    }
}

exports.toggleUserStatus = async (userId, res) => {
    try {
        // Find the user by their ID
        const user = await userModel.findById(userId); 
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
    
        // Toggle the user's status (active <-> inactive)
        user.status = user.status === 'active' ? 'inactive' : 'active';
    
        // Save only the status field (no need to revalidate other fields like mobile)
        await user.save({ validateModifiedOnly: true }); 
    
        // Respond with the updated user object
        return res.status(200).json({
            message: `User status has been successfully updated.`,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                status: user.status,  
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'An error occurred while toggling user status' });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const {_id, password } = req.body;
        const user = await userModel.findOne({ _id: new ObjectId(_id) });
        if (!user) {
            return res({ status: 400, message: 'User not found' })
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        user.password = hashedPassword;
        await user.save();
        return res({status: 200, message: 'Password has been reset successfully' })
    } catch (err) {
        console.log(err)
        return res({ status: 500, message: err });
    }
}

exports.getUserDashboard = async (body, res) => {
    try {
        let data = {
            totalRedeemablePoints: 0,
            totalValue: 0,
            userTotalRewards: 0,
            userTotalCash: 0,
        }
        if (body.accountType === 'Super User') {
            let couponData = await Transaction.aggregate([{$group: {_id: null, total: { $sum: "$redeemablePoints" }, totalValue: { $sum: "$value" }}}]);
            let userData = await userModel.aggregate([{$group: {_id: null, redeemablePoints: { $sum: "$redeemablePoints" }, cash: { $sum: "$cash" }}}]);
            let redeemedUsers = await redeemedUserModel.aggregate([{$group: {_id: null, redeemedPoints: { $sum: "$redeemedPoints" }, cash: { $sum: "$cash" }}}]);
            data.userTotalRewards = userData[0].redeemablePoints + redeemedUsers[0]?.redeemedPoints;
            data.userTotalCash = userData[0].cash + redeemedUsers[0]?.cash;
            data.totalRedeemablePoints = couponData[0].total;
            data.totalValue = couponData[0].totalValue;
        } else {
            let userData = await userModel.findOne({_id: new ObjectId(body.id)}, {password: 0, token: 0});
            data.userTotalRewards = userData.redeemablePoints;
            data.userTotalCash = userData.cash;
            let querySet = [
                { $match: {redeemedBy: body.id} },
                { $addFields: { batchId: { $toObjectId: "$batchId" } } },
                { $lookup: { from: 'batchnumbers', localField: 'batchId', foreignField: '_id', as: 'batchData' } },
                { $unwind: '$batchData' },
                { $addFields: { redeemedBy: { $cond: { if: { $eq: ["$redeemedBy", null] }, then: null, else: { $toObjectId: "$redeemedBy" } } } } },
                { $lookup: { from: 'users', localField: 'redeemedBy', foreignField: '_id', as: 'redeemedData' } },
                { $unwind: { path: '$redeemedData', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: 1,
                        transactionId: 1,
                        batchId: 1,
                        batchName: { $ifNull: ['$batchData.Branch', ''] },
                        batchNumber: { $ifNull: ['$batchData.BatchNumber', ''] },
                        couponCode: 1,
                        redeemablePoints: { $ifNull: ['$batchData.RedeemablePoints', ''] },
                        value: { $ifNull: ['$batchData.value', ''] },
                        couponValue: 1,
                        redeemedBy: 1,
                        redeemedByName:  { $ifNull: ['$redeemedData.name', ''] },
                        redeemedByMobile: 1,
                        isProcessed: 1,
                        createdAt: 1,
                    }
                },
            ]
            data.userTotalRedeemablePointsList = await Transaction.aggregate(querySet);
        }
        return res({status: 200, data});
    } catch (err) {
        console.log(err)
        return res({status: 500, message: "Something went wrong"});
    }
}
