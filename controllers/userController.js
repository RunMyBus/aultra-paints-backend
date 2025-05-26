const userModel = require('../models/User');
const bcrypt = require("bcryptjs");
const { ObjectId } = require('mongodb');
const Transaction = require('../models/Transaction');
const redeemedUserModel = require("../models/redeemedUser.model");
const UserLoginSMSModel = require("../models/UserLoginSMS");
const axios = require("axios");
const { validateAndCreateOTP } = require('../services/user.service');
const { Parser } = require('json2csv');

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

         // Initialize the $or condition
          query['$or'] = [];

// Filter by search query (name, mobile,)
        if (body.searchQuery) {
            query['$or'] = [
                { 'name': { $regex: new RegExp(body.searchQuery.trim(), "i") } },
                { 'mobile': { $regex: new RegExp(body.searchQuery.trim(), "i") } }
            ];
            
            // Filter out painters with no parentDealerCode
            query['$nor'] = [
                { accountType: 'Painter', parentDealerCode: { $in: [null, ''] } }
            ];
        }
    
        // Account Type filter
        if (body.accountType && ['All', 'Dealer', 'Contractor', 'Painter', 'SuperUser', 'SalesExecutive'].includes(body.accountType)) {
            if (body.accountType !== 'All') {
                query.accountType = body.accountType;
            }
        }

        // Apply the condition for painters and non-painters
        if (query['$or'].length === 0) {
            // If no $or condition from search query, only apply the painter condition
            query['$or'].push({ accountType: { $ne: 'Painter' } });
            query['$or'].push({
                accountType: 'Painter',
                parentDealerCode: { $nin: [null] }
            });
        }

        // Fetch the filtered data
        let data = await userModel.find(query, { password: 0 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));
        
        const totalUsers = await userModel.countDocuments(query);
        return res({ status: 200, data, total: totalUsers, pages: Math.ceil(totalUsers / limit), currentPage: page });
    } catch (err) {
        return res({ status: 500, message: `Something went wrong: ${err.message}` });
    }
};



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

        // Dealer-specific checks
        if (body.accountType && body.accountType.toLowerCase() === 'dealer') {
            if (!body.primaryContactPerson) errorArray.push('Primary contact person is required for dealers');
            if (!body.primaryContactPersonMobile) errorArray.push('Primary contact person mobile is required for dealers');
            if (!body.dealerCode) errorArray.push('Dealer code is required for dealers');
            if (!body.salesExecutive) {
                errorArray.push('Sales executive is required for dealers');
                // if (!body.state) errorArray.push('State is required for dealers');
                // if (!body.zone) errorArray.push('Zone is required for dealers');
                // if (!body.district) errorArray.push('District is required for dealers');
            }
            
            if (body.dealerCode) {
                // Check if the dealer code already exists
                const oldDealerCode = await userModel.findOne({
                    dealerCode: { 
                        $regex: new RegExp(`^${body.dealerCode.trim()}$`),
                        "$options": "i"
                    }
                });

                if (oldDealerCode) {
                    if (oldDealerCode._id.toString() !== body.id) {
                        errorArray.push('Dealer code already exists');
                    }
                }
            }
            if (!body.address) errorArray.push('Address is required for dealers');
        } else {
            body.dealerCode = null;
            body.primaryContactPerson = null;
            body.primaryContactPersonMobile = null;
            body.salesExecutive = null;
            body.address = null;
            body.state = null;
            body.zone = null;
            body.district = null;
        }

        if (errorArray.length) {
            return res({ status: 400, errors: errorArray })
        }
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
            if (!body.salesExecutive) {
                errorArray.push('Sales executive is required for dealers');
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
            // if (!body.state) {
            //     errorArray.push('State is required for dealers');
            // }
            // if (!body.zone) {
            //     errorArray.push('Zone is required for dealers');
            // }
            // if (!body.district) {
            //     errorArray.push('District is required for dealers');
            // }
        } else {
            body.dealerCode = null;
            body.primaryContactPerson = null;
            body.primaryContactPersonMobile = null;
            body.salesExecutive = null;
            body.address = null;
            body.state = null;
            body.zone = null;
            body.district = null;
        }

         // Check and set parentDealerCode to null if empty or undefined
         if (body.parentDealerCode === "" || body.parentDealerCode === undefined) {
            body.parentDealerCode = null;
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
            {"title": "Redeemed Points", "description": "Redeemed Points Confirmation", "count": data.rewardPoints},
            {"title": "Earned Cash Reward", "description": "Earned Cash Reward Confirmation", "count": data.cash},
        ];
        return res({status: 200, data: data})
    } catch (err) {
        return res({status: 500, message: err})
    }
}

// max-width: 250px;
// max-height: 250px;
// height: auto;
// width: 100%;
// padding: 1.5rem;

exports.deleteUser = async (id, res) => {
    try {
        const data = await userModel.deleteOne({_id: new ObjectId(id)});
        return res({status: 200, data: data})
    } catch (err) {
        return res({status: 500, message: err})
    }
}

exports.accountSuspended = async (mobile, res) => {
    try {
        const data = await userModel.updateOne({ mobile: mobile }, { $set: { accountStatus: false } });
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
        let userData = await userModel.findOne({_id: new ObjectId(body.id)}, {password: 0, token: 0});
        data.userTotalRewards = userData.rewardPoints;
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
                    branchName: { $ifNull: ['$batchData.Branch', ''] },
                    batchNumber: { $ifNull: ['$batchData.BatchNumber', ''] },
                    couponCode: 1,
                    redeemablePoints: { $ifNull: ['$batchData.RedeemablePoints', ''] },
                    value: { $ifNull: ['$batchData.value', ''] },
                    //couponValue: 1,
                    //redeemedBy: 1,
                    //redeemedByName:  { $ifNull: ['$redeemedData.name', ''] },
                    //redeemedByMobile: 1,
                    isProcessed: 1,
                    createdAt: 1,
                    updatedAt: 1,
                }
            },
        ]
        data.userTotalRedeemablePointsList = await Transaction.aggregate(querySet);
        return res({status: 200, data});
    } catch (err) {
        console.log(err)
        return res({status: 500, message: "Something went wrong"});
    }
}

exports.getUnverifiedUsers = async (body, res) => {
    try {
        let page = parseInt(body.page || 1);
        let limit = parseInt(body.limit || 10);
        let query = { 
            accountType: 'Painter',
            parentDealerCode: null,
            
        };

        // Add search query if provided for mobile number
        if (body.searchQuery) {
            query['mobile'] = { 
                $regex: new RegExp(body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")
            };
        }

        let data = await userModel.find(query) 
                                   .skip((page - 1) * limit)   
                                   .limit(limit);              

        const totalUsers = await userModel.countDocuments(query); 
        return res({ status: 200, data, total: totalUsers, pages: Math.ceil(totalUsers / limit), currentPage: page });
        
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            status: 500,
            message: `Something went wrong. Error: ${err.message}`
        });
    }
};


const username = config.SMS_USERNAME;
const apikey = config.SMS_APIKEY;
const message = 'SMS MESSAGE';
const sender = config.SMS_SENDER;
const apirequest = 'Text';
const route = config.SMS_ROUTE;
const templateid = config.SMS_TEMPLATEID_AULTRA_OPT;

exports.getParentDealerCodeUser = async (body, res) => {
    try {
        let query = {};
        if (body.dealerCode) {
            query['$or'] = [
                // {'dealerCode': {$regex: new RegExp(body.dealerCode.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
                {'dealerCode': body.dealerCode.toString().trim()},
                {'mobile': body.dealerCode.toString().trim()}
            ]
        }
        let data = await userModel.findOne(query, {password: 0});

        if (!data) {
            return res({status: 400, message: "Dealer Code not found"});
        }

        const { OTP, isStatic } = await validateAndCreateOTP(data.mobile);
        if (!isStatic) {
            // Sending OTP via SMS
            const params = {
                username: username,
                apikey: apikey,
                apirequest: "Text",
                route: route,
                sender: sender,
                mobile: data.mobile,
                TemplateID: templateid,
                message: `Dear ${data.name}, to add the painter to your network please share this OTP ${OTP} with him/her. AULTRA`,
                format: "JSON"
            };
            const queryParams = require('querystring').stringify(params);
            const requestUrl = `http://sms.infrainfotech.com/sms-panel/api/http/index.php?${queryParams}`;
            const response = await axios.get(requestUrl);
            console.log("SMS Response:", response.data);
        }
        return res({status: 200, data});
    } catch (err) {
        console.log(err)
        return res({status: 500, message: "Something went wrong"});
    }
}

exports.verifyOtpUpdateUser = async (body, res) => {
    try {
        let userLoginSMS = await UserLoginSMSModel.findOne({mobile: body.mobile, otp: body.otp, active: true}).sort({createdAt: -1}).limit(1);
        if (!userLoginSMS) {
            return res({status: 400, error: 'INVALID OTP'})
        }
        if (userLoginSMS.expiryTime < Date.now()) {
            return res({status: 400, error: 'OTP EXPIRED'})
        }
        userLoginSMS.active = false;
        await userLoginSMS.save();

        // let user = await User.findOne({mobile: body.mobile});
        let user = await userModel.findOneAndUpdate({mobile: body.painterMobile}, {parentDealerCode: body.dealerCode.toString().trim()}, {new: true});
        return res({status: 200, data: user});
    } catch (err) {
        console.log(err)
        return res({status: 500, message: "Something went wrong"});
    }
}

exports.getMyPainters = async (req, res) => {
    try {
        let page = parseInt(req.body.page || 1);
        let limit = parseInt(req.body.limit || 10);
        // Fetch the logged-in user's details by ID
        const dealer = await userModel.findById(req.user._id.toString());
        if (!dealer) {
            throw new Error('Dealer not found');
        }
        // Check if the logged-in user is a dealer
        if (dealer.accountType !== 'Dealer') {
            throw new Error('User is not a dealer');
        }
        // Fetch all painter users whose parentDealerCode matches the dealer's dealerCode
        const painters = await userModel.find({
            accountType: 'Painter',
            parentDealerCode: dealer.dealerCode,
        }).skip((page - 1) * limit).limit(parseInt(limit));
        return res({status: 200, data: painters})
    } catch (error) {
        console.error('Error fetching painters:', error.message);
        //throw error;
        return res({status: 200, data: error.message})
    }
}

exports.getUserDealer = async (dealerCode, res) => {
    try {
        const dealer = await userModel.findOne({dealerCode: dealerCode });
        if (!dealer) {
            return res({status: 400, data: dealer})
        }
        return res({status: 200, data: dealer});
    } catch (err) {
        console.error('Error fetching dealer:', err.message);
        return res({status: 500, error: err});
    }
}

exports.getDealers = async (body, res) => {
    try {
        let query = { accountType: 'Dealer' };
        query['$or'] = [];
        if (body.searchQuery) {
            query['$or'] = [
                { 'name': { $regex: new RegExp(body.searchQuery.trim(), "i") } },
                { 'mobile': { $regex: new RegExp(body.searchQuery.trim(), "i") } }
            ];
        }
        const dealers = await userModel.find(query);
        return res({ status: 200, data: dealers });
    } catch (err) {
        console.error('Error fetching dealers: ', err.message);
        return res({ status: 500, error: err });
    }
}


exports.getAllSalesExecutives = async (req, res) => {
    try {
        const salesExecutives = await userModel.find(
            { accountType: 'SalesExecutive' },
            { name: 1, mobile: 1 } 
        ).sort({ name: 1 }); 

        return res.status(200).json({
            status: 'success',
            data: salesExecutives.map(exec => ({
                id: exec._id,
                name: exec.name,
                mobile: exec.mobile
            }))
        }); 
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: 'Error fetching sales executives'
        });
    }
};

exports.exportUsers = async (req, res) => {  // Changed to handle req and res directly
    try {
        let query = {};
        query['$or'] = [];

        // Filter by search query if provided
        if (req.body.searchQuery) {
            query['$or'] = [
                { 'name': { $regex: new RegExp(req.body.searchQuery.trim(), "i") } },
                { 'mobile': { $regex: new RegExp(req.body.searchQuery.trim(), "i") } }
            ];
            
            query['$nor'] = [
                { accountType: 'Painter', parentDealerCode: { $in: [null, ''] } }
            ];
        }
    
        // Account Type filter
        if (req.body.accountType && ['All', 'Dealer', 'Contractor', 'Painter', 'SuperUser', 'SalesExecutive'].includes(req.body.accountType)) {
            if (req.body.accountType !== 'All') {
                query.accountType = req.body.accountType;
            }
        }

        // Apply the condition for painters and non-painters
        if (query['$or'].length === 0) {
            query['$or'].push({ accountType: { $ne: 'Painter' } });
            query['$or'].push({
                accountType: 'Painter',
                parentDealerCode: { $nin: [null] }
            });
        }

        // Fetch all users without pagination
        const users = await userModel.find(query, {
            name: 1,
            mobile: 1,
            accountType: 1,
            rewardPoints: 1,
            cash: 1,
            status: 1,
            createdAt: 1,
            _id: 0
        });

        // Prepare data for CSV
        const csvData = users.map(user => ({
            Name: user.name || '',
            Mobile: user.mobile || '',
            Role: user.accountType || '',
            'Reward Points': user.rewardPoints || 0,
            'Cash Reward': user.cash || 0,
            Status: user.status || '',
            'Created Date': user.createdAt ? new Date(user.createdAt).toLocaleDateString().replaceAll('/', '-') : ''
        }));

        // CSV Parser options
        const fields = ['Name', 'Mobile', 'Role', 'Reward Points', 'Cash Reward', 'Status', 'Created Date'];
        const opts = { fields };
        
        // Create parser and convert to CSV
        const parser = new Parser(opts);
        const csv = parser.parse(csvData);

        // Set response headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=Users_${new Date().toLocaleDateString().replaceAll('/', '-')}.csv`);
        
        // Send the CSV data
        return res.send(csv);
    } catch (err) {
        console.error('Export error:', err);
        return res.status(500).json({
            status: 500,
            message: `Export failed: ${err.message}`
        });
    }
};

exports.exportUnverifiedUsers = async (req, res) => {
    try {
        let query = { 
            accountType: 'Painter',
            parentDealerCode: null
        };

        // Fetch all unverified users
        const users = await userModel.find(query, {
            name: 1,
            mobile: 1,
            accountType: 1,
            rewardPoints: 1,
            cash: 1,
            status: 1,
            createdAt: 1,
            _id: 0
        });

        // Prepare data for CSV
        const csvData = users.map(user => ({
            Name: user.name || '',
            Mobile: user.mobile || '',
            Role: user.accountType || '',
            'Reward Points': user.rewardPoints || 0,
            'Cash Reward': user.cash || 0,
            Status: user.status || '',
            'Created Date': user.createdAt ? new Date(user.createdAt).toLocaleDateString() : ''
        }));

        // CSV Parser options
        const fields = ['Name', 'Mobile', 'Role', 'Reward Points', 'Cash Reward', 'Status', 'Created Date'];
        const opts = { fields };
        
        // Create parser and convert to CSV
        const parser = new Parser(opts);
        const csv = parser.parse(csvData);

        // Set response headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=UnverifiedUsers-${new Date().toISOString().split('T')[0]}.csv`);
        
        // Send the CSV data
        return res.send(csv);
    } catch (err) {
        console.error('Export error:', err);
        return res.status(500).json({
            status: 500,
            message: `Export failed: ${err.message}`
        });
    }
};
