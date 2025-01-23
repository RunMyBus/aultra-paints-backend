const jwt = require("jsonwebtoken");
const User = require('../models/User');
const StaticPhoneNumbers = require('../models/staticPhoneNumbers')
const bcrypt = require('bcryptjs');
const Transaction = require("../models/Transaction");
const redeemedUserModel = require("../models/redeemedUser.model");
const Batch = require("../models/batchnumber");
const {ObjectId} = require("mongodb");
const sms = require('../services/sms.service');
const axios = require("axios");
const UserLoginSMSModel = require('../models/UserLoginSMS')
const transactionLedger = require("../models/TransactionLedger");

async function generateToken(user, next) {
    try {
        const token = jwt.sign(user, 'aultra-paints');
        if (user) {
            await User.findByIdAndUpdate(user._id, {token})
        }
        next(token);
    } catch (err) {
        console.error('TOKEN_ERROR:', err);
    }
}

exports.login = async (req, next) => {
    let user = {name: req.user.name, mobile: req.user.mobile, email: req.user.email, _id: req.user._id};
    await generateToken(user, token => {
        next({
            status: 200,
            email: req.user.email,
            mobile: req.user.mobile,
            id: req.user._id,
            fullName: req.user.name,
            token: token,
            accountType: req.user.accountType,
            redeemablePoints: req.user.redeemablePoints,
            cash: req.user.cash,
            parentDealerCode: req.user.parentDealerCode,
            message: "LOGGED_IN_SUCCESSFULLY"
        });
    });
}

exports.register = async (req, next) => {
    const { name, email, password, mobile } = req.body; 
    try {
        // Check if the user already exists by email
        // let user = await User.findOne({ email });
        // if (user) {
        //     return next({ status: 400, message: 'User already exists with this email' });
        // }

        // Check if the mobile number already exists
        user = await User.findOne({ mobile });
        if (user) {
            return next({ status: 400, message: 'Mobile number already exists' });
        }

        // Ensure mobile number is provided
        if (!mobile) {
            return next({ status: 400, message: 'Mobile number is required' });
        }

        // const salt = await bcrypt.genSalt(10);
        // const hashedPassword = await bcrypt.hash(password, salt);

        // Create a new user instance
        user = new User({
            name,
            mobile, 
        });

        await user.save();

        return next({ status: 200, message: 'User registered successfully' });
    } catch (err) {
        console.error(err);
        return next({ status: 500, message: 'Server error' });
    }
}

exports.redeem = async (req, next) => {
    try {
        const { mobile, name } = req.body;
        const qr = req.params.qrCodeID;

        // Find the user by mobile number
        let user = await User.findOne({ mobile });

        // Find the transaction by the QR code
        const transaction = await Transaction.findOne({ UDID: qr });
        if (!transaction) {
            return next({status: 404, message: `Transaction not found for QR code: ${qr}` });
        }

        if (transaction.cashRedeemedBy !== undefined) {
            return next({status: 400, message: 'Coupon already redeemed.' });
        }

        // If the user is found, update the transaction and user
        if (user) {
            const updatedTransaction = await Transaction.findOneAndUpdate(
                { UDID: qr },
                { updatedBy: user._id, cashRedeemedBy: req.body.mobile },
                { new: true }
            );

            if (!updatedTransaction) {
                return next({status: 404, message: `Transaction with QR code ${qr} not found after update.` });
            }

            // const redeemablePointsCount = updatedTransaction.redeemablePoints || 0;
            const cashCount = updatedTransaction.value || 0;

            const userData = await User.findOneAndUpdate(
                { _id: updatedTransaction.updatedBy },
                {
                    $inc: {
                        // rewardPoints: redeemablePointsCount,
                        cash: cashCount,
                    }
                },
                { new: true }
            );

            if (!userData) {
                return next({status: 404, message: 'User not found for the transaction update.' });
            }

            const data = {
                name: userData.name || name,
                mobile: userData.mobile,
                // redeemablePoints: updatedTransaction.redeemablePoints,
                couponCode: updatedTransaction.couponCode,
                cash: updatedTransaction.value,
            };

            await transactionLedger.create({
                narration: 'Scanned QR and redeemed cash.',
                amount: updatedTransaction.value,
                balance: userData.cash,
                userId: userData._id
            });

            return next({ status: 200, message: "Coupon redeemed Successfully..!", data: data });

        } else {
            // If the user does not exist, create a new user and save the redeemed points and cash
            // const redeemablePointsCount = transaction.redeemablePoints || 0;
            const cashCount = transaction.value || 0;

            const newUser = new User({
                name: name || 'NA',  
                mobile: mobile,
                // rewardPoints: redeemablePointsCount,
                cash: cashCount,
            });

            const userData = await newUser.save();

            // Update the transaction to mark it as processed with the new user's information
            const updatedTransaction = await Transaction.findOneAndUpdate(
                { UDID: qr },
                { updatedBy: userData._id, cashRedeemedBy: req.body.mobile },
                { new: true }
            );

            if (!updatedTransaction) {
                return next({ status: 404, message: `Transaction with QR code ${qr} not found after creating new user.` });
            }

            const data = {
                mobile: userData.mobile,
                name: userData.name || 'NA',
                // redeemablePoints: updatedTransaction.redeemablePoints,
                couponCode: updatedTransaction.couponCode,
                cash: updatedTransaction.value,
            };

            await transactionLedger.create({
                narration: `Scanned coupon ${updatedTransaction.couponCode} and redeemed cash.`,
                amount: updatedTransaction.value,
                balance: userData.cash,
                userId: userData._id
            });

            return next({ status: 200, message: "Coupon redeemed Successfully..!", data: data });
        }

    } catch (err) {
        console.error(err);
        return next({ status: 500, message: 'Server error' });
    }
};

const username = config.SMS_USERNAME;
const apikey = config.SMS_APIKEY;
const message = 'SMS MESSAGE';
const sender = config.SMS_SENDER;
const apirequest = 'Text';
const route = config.SMS_ROUTE;
const templateid = config.SMS_TEMPLATEID;

exports.smsFunction = async (req, res) => {
    const { mobile, message } = req.body;
    try {
        const params = {
            username: username,
            apikey: apikey,
            apirequest: "Text",
            route: route,
            sender: sender,
            mobile: req.body.mobile,
            TemplateID: templateid,
            message: `Aultra Paints: Your OTP for login is ${OTP}. This code is valid for 10 minutes. Do not share this OTP with anyone`,
            format: "JSON"
        };

        const queryParams = require('querystring').stringify(params);
        const requestUrl = `http://sms.infrainfotech.com/sms-panel/api/http/index.php?${queryParams}`;

        console.log("Request URL:", requestUrl);

        // Send the HTTP request
        await require('http').get(requestUrl, (response) => {
            let data = '';
            // Collect the response data
            response.on('data', (chunk) => {
                data += chunk;
            });

            // Handle the response completion
            response.on('end', () => {
                console.log("SMS Response:", data);
                return res({status: 200, message: 'SMS sent successfully', response: data });
            });
        }).on('error', (err) => {
            console.error("HTTP Error:", err.message);
            return res({status: 500,  error: err.message });
        });

    } catch (error) {
        console.error("Error sending SMS:", error);
        return res({status: 500, error: 'Failed to send SMS' });
    }
}

// Helper function to generate a random 6-digit OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

exports.loginWithOTP = async (req, res) => {
    const { mobile } = req.body;
    const OTP_EXPIRY_MINUTES = 10;

    if (!mobile) return res({status: 500, error: 'Mobile number is required' });

    let user = await User.findOne({mobile: mobile});
    if (!user) {
        return res({status: 400, error: 'MOBILE_NOT_FOUND'})
    } else if (user && user.status === 'inactive') {
        return res({status: 400, error: 'ACCOUNT_SUSPENDED'});
    }

    const staticPhoneNumbers = await StaticPhoneNumbers.find();
    const mobileNumbers = staticPhoneNumbers.map(doc => doc.mobile);

    try {
        let OTP = generateOTP();
        const expiryTime = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
        if (mobile === config.STATIC_MOBILE_NUMBER) {
            OTP = config.STATIC_OTP;
            await UserLoginSMSModel.create({mobile: mobile, otp: OTP, expiryTime });
            return res({status: 200, message: 'OTP sent successfully.'});
        }else if (mobileNumbers.includes(mobile)) {
            OTP = 123456;
            await UserLoginSMSModel.create({mobile: mobile, otp: OTP, expiryTime });
            return res({status: 200, message: 'OTP sent successfully.'});
        }

        await UserLoginSMSModel.create({mobile: mobile, otp: OTP, expiryTime });
        // Sending OTP via SMS
        const params = {
            username: username,
            apikey: apikey,
            apirequest: "Text",
            route: route,
            sender: sender,
            mobile: mobile,
            TemplateID: templateid,
            message: `Aultra Paints: Your OTP for login is ${OTP}. This code is valid for 10 minutes. Do not share this OTP with anyone`,
            format: "JSON"
        };
        const queryParams = require('querystring').stringify(params);
        const requestUrl = `http://sms.infrainfotech.com/sms-panel/api/http/index.php?${queryParams}`;
        const response = await axios.get(requestUrl);
        console.log("SMS Response:", response.data);
        return res({status: 200, message: 'OTP sent successfully.'})
        //return res.status(200).json({ message: 'OTP sent successfully' });
    } catch (error) {
        console.error("Error sending OTP:", error);
        return res({status: 500, message: 'Failed to send OTP.'})
        //return res.status(500).json({ error: 'Failed to send OTP' });
    }
};
