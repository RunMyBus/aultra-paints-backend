const jwt = require("jsonwebtoken");
const User = require('../models/User'); 
const bcrypt = require('bcryptjs');
const Transaction = require("../models/Transaction");
const Batch = require("../models/batchnumber");
const {ObjectId} = require("mongodb");


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
            redeemablePoints: req.user.redeemablePoints,
            cash: req.user.cash,
            message: "LOGGED_IN_SUCCESSFULLY"
        });
    });
}

exports.register = async (req, next) => {
    const { name, email, password, mobile } = req.body; 
    try {
        // Check if the user already exists by email
        let user = await User.findOne({ email });
        if (user) {
            return next({ status: 400, message: 'User already exists with this email' });
        }

        // Check if the mobile number already exists
        user = await User.findOne({ mobile });
        if (user) {
            return next({ status: 400, message: 'Mobile number already exists' });
        }

        // Ensure mobile number is provided
        if (!mobile) {
            return next({ status: 400, message: 'Mobile number is required' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create a new user instance
        user = new User({
            name,
            email,
            password: hashedPassword,
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
        const { mobile } = req.body;
        const qr = req.params.qrCodeID
        const user = await User.findOne({ mobile });
        if (!user) {
            return next({status: 404, message: 'User not found.' });
        }
        const transaction = await Transaction.findOne({ qr_code_id: qr });
        if (!transaction) {
            return next({status: 404, message: 'Transaction not found.' });
        }
        if (transaction.isProcessed) {
            return next({status: 400, message: 'Coupon already redeemed.' });
        }
        const updatedTransaction = await Transaction.findOneAndUpdate(
            { qr_code_id: qr },
            { isProcessed: true, updatedBy: user._id, redeemedBy: new ObjectId(user._id) },
            { new: true }
        );
        let batch = {};
        if (updatedTransaction.isProcessed) {
            let getTransaction = await Transaction.findOne({qr_code_id: qr})
            batch = await Batch.findOne({_id: getTransaction.batchId});
            if (batch) {
                const redeemablePointsCount = batch.RedeemablePoints || 0;
                const cashCount = batch.value || 0;

                // Update the user fields safely
                const userData = await User.findOneAndUpdate(
                    { _id: updatedTransaction.updatedBy },
                    [
                        {
                            $set: {
                                redeemablePoints: {
                                    $add: [{ $ifNull: ["$redeemablePoints", 0] }, redeemablePointsCount],
                                },
                                cash: {
                                    $add: [{ $ifNull: ["$cash", 0] }, cashCount],
                                }
                            }
                        }
                    ],
                    { new: true } // Return the updated document
                );

                if (!userData) {
                    return next({status: 404, message: 'User not found for update.' });
                }
            }
        }

        if (!updatedTransaction) {
            return next({status: 404, message: 'Transaction not found.'});
        }

        const data = {
            qr_code_id: updatedTransaction.qr_code_id,
            isProcessed: updatedTransaction.isProcessed,
            redeemablePoints: updatedTransaction.redeemablePoints,
            couponCode: transaction.couponCode,
            cash: batch.value,
            batchName: batch.Branch,
            batchNumber: batch.BatchNumber,
        }

        return next({status: 200, message: "Coupon redeemed Successfully..!", data: data});

    } catch (err) {
        console.error(err);
        return next({ status: 500, message: 'Server error' });
    }
}
