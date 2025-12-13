const jwt = require("jsonwebtoken");
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const Transaction = require("../models/Transaction");
const redeemedUserModel = require("../models/redeemedUser.model");
const Batch = require("../models/batchnumber");
const {ObjectId} = require("mongodb");
const sms = require('../services/sms.service');
const axios = require("axios");
const transactionLedger = require("../models/TransactionLedger");
const logger = require("../utils/logger");
const cashFreePaymentService = require('../services/cashFreePaymentService');
const BulkPePaymentService = require('../services/bulkPePaymentService');
const { validateAndCreateOTP } = require('../services/user.service');

async function generateToken(user, next) {
    try {
        const token = jwt.sign(user, 'aultra-paints');
        if (user) {
            await User.findByIdAndUpdate(user._id, {token})
        }
        next(token);
    } catch (err) {
        logger.error('TOKEN_ERROR:', err);
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
        logger.error(err);
        return next({ status: 500, message: 'Server error' });
    }
}

const bulkPePGActivated = config.ACTIVATE_BULKPE_PG;
const cashFreePGActivated = config.ACTIVATE_CASHFREE_PG;

exports.redeemCash = async (req, next) => {
    try {
        const { mobile, upi } = req.body;
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

        /*const paymentResult = await cashFreePaymentService.pay2Phone(mobile, name, transaction.value);
        if (!paymentResult.success) {
            return next({ status: 400, message: paymentResult.message });
        }*/

        const beneficiaryName = user?.name || mobile.toString();
        let paymentResult;

        if (bulkPePGActivated) {
            paymentResult = await BulkPePaymentService.upiPayment(upi, beneficiaryName, transaction.value);
        } else if (cashFreePGActivated) {
            paymentResult = await cashFreePaymentService.upiPayment(upi, mobile, transaction.value);
        } else {
            throw new Error('No payment gateway is enabled in environment variables.');
        }
        if (!paymentResult.success) {
            return next({ status: 400, message: paymentResult.message });
        }

        // If the user is found, update the transaction and user
        if (user) {
            const updatedTransaction = await Transaction.findOneAndUpdate(
                { UDID: qr },
                { $set: { updatedBy: user._id, cashRedeemedBy: req.body.mobile, cashRedeemedAt: new Date(), upiId: upi } },
                { new: true }
            );

            if (!updatedTransaction) {
                return next({status: 404, message: `Transaction with QR code ${qr} not found after update.` });
            }

            // const redeemablePointsCount = updatedTransaction.redeemablePoints || 0;
            const cashValue = updatedTransaction.value || 0;

            const userData = await User.findOneAndUpdate(
                { _id: updatedTransaction.updatedBy },
                {
                    $inc: {
                        // rewardPoints: redeemablePointsCount,
                        cash: cashValue,
                    }
                },
                { new: true }
            );

            if (!userData) {
                return next({status: 404, message: 'User not found for the transaction update.' });
            }

            const ledgerEntry = {
                name: userData.name || mobile.toString(),
                mobile: userData.mobile,
                // redeemablePoints: updatedTransaction.redeemablePoints,
                couponCode: updatedTransaction.couponCode,
                cash: updatedTransaction.value,
            };

            await transactionLedger.create({
                narration: `Scanned coupon code ${updatedTransaction.couponCode} and redeemed cash.`,
                amount: `+ ${updatedTransaction.value}`,
                balance: userData.cash,
                userId: userData._id,
                couponId: updatedTransaction._id
            });
            return next({ status: 200, message: "Coupon redeemed and payment initiated successfully!", data: ledgerEntry });

        } else {
            // If the user does not exist, create a new user and save the redeemed points and cash
            // const redeemablePointsCount = transaction.redeemablePoints || 0;
            const cashValue = transaction.value || 0;

            const newUser = new User({
                name: mobile.toString() || 'NA',
                mobile: mobile,
                // rewardPoints: redeemablePointsCount,
                cash: cashValue,
                upiID: upi
            });

            const userData = await newUser.save();

            // Update the transaction to mark it as processed with the new user's information
            const updatedTransaction = await Transaction.findOneAndUpdate(
                { UDID: qr },
                { updatedBy: userData._id, cashRedeemedBy: req.body.mobile, upiId: upi },
                { new: true }
            );

            if (!updatedTransaction) {
                return next({ status: 404, message: `Transaction with QR code ${qr} not found after creating new user.` });
            }

            const data = {
                mobile: userData.mobile,
                name: userData.name || 'NA',
                couponCode: updatedTransaction.couponCode,
                cash: updatedTransaction.value,
                upiId: upi
            };

            await transactionLedger.create({
                narration: `Scanned coupon ${updatedTransaction.couponCode} and redeemed cash.`,
                amount: `+ ${updatedTransaction.value}`,
                balance: userData.cash,
                userId: userData._id,
                couponId: updatedTransaction._id
            });

            return next({ status: 200, message: "Coupon redeemed and payment initiated successfully!", data: data });
        }

    } catch (err) {
        logger.error('Error in redeemCash.', { reqBody: req.body, reqParams: req.params, error: err });
        return next({ status: 500, message: err.message });
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

        logger.info("Request URL:", requestUrl);

        // Send the HTTP request
        await require('http').get(requestUrl, (response) => {
            let data = '';
            // Collect the response data
            response.on('data', (chunk) => {
                data += chunk;
            });

            // Handle the response completion
            response.on('end', () => {
                logger.info("SMS Response:", data);
                return res({status: 200, message: 'SMS sent successfully', response: data });
            });
        }).on('error', (err) => {
            logger.error("HTTP Error:", err.message);
            return res({status: 500,  error: err.message });
        });

    } catch (error) {
        logger.error("Error sending SMS:", error);
        return res({status: 500, error: 'Failed to send SMS' });
    }
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

    try {
        const { OTP, isStatic } = await validateAndCreateOTP(mobile);

        if (!isStatic) {
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
            logger.info("SMS Response:", response.data);
        }
        return res({status: 200, message: 'OTP sent successfully.'});
    } catch (error) {
        logger.error("Error sending OTP:", error);
        return res({status: 500, message: 'Failed to send OTP.'})
    }
};
