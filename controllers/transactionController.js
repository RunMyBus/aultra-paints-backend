const Transaction = require('../models/Transaction');
const mongoose = require("mongoose");
const Batch = require("../models/batchnumber");
const User = require('../models/User');
const sequenceModel = require("../models/sequence.model");
const {ObjectId} = require("mongodb");

exports.getAllTransactionsForBatch = async (req, res) => {
    // console.log(req.body)
    try {
        let page = parseInt(req.body.page || 1);
        let limit = parseInt(req.body.limit || 10);

        const { batchId, userId } = req.body;
        let query = {};
        if (batchId)
            query.batchId = new ObjectId(batchId);
        if (userId)
            query.redeemedBy = userId;

        let querySet = [
            { $match: query },
            { $addFields: { batchId: { $toObjectId: "$batchId" } } },
            { $lookup: { from: 'batchnumbers', localField: 'batchId', foreignField: '_id', as: 'batchData' } },
            { $unwind: '$batchData' },

            { $addFields: { createdBy: { $toObjectId: "$createdBy" } } },
            { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'userData' } },
            { $unwind: '$userData' },

            // { $addFields: { updatedBy: { $toObjectId: "$updatedBy" } } },
            { $addFields: { updatedBy: { $cond: { if: { $eq: ["$updatedBy", null] }, then: null, else: { $toObjectId: "$updatedBy" } } } } },
            { $lookup: { from: 'users', localField: 'updatedBy', foreignField: '_id', as: 'uploadData' } },
            { $unwind: { path: '$uploadData', preserveNullAndEmptyArrays: true } },

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
                    createdByName: { $ifNull: ['$userData.name', ''] },
                    updatedByName: { $ifNull: ['$uploadData.name', ''] },
                    createdBy: 1,
                    updatedBy: 1,
                    qr_code_id: 1,
                    qr_code: 1,
                    couponValue: 1,
                    points: 1,
                    redeemedBy: 1,
                    redeemedByName:  { $ifNull: ['$redeemedData.name', ''] },
                    redeemedByMobile: 1,
                    isProcessed: 1,
                    createdAt: 1,
                    updatedAt: 1,
                }
            },
            { $sort: { createdAt: -1, _id: -1 } },
            { $skip: ((page - 1) * limit) },
            { $limit: limit },
        ];
        const transactionsData = await Transaction.aggregate(querySet)
        const totalTransaction = await Transaction.countDocuments(query);
        return res.status(200).json({
            total: totalTransaction,
            pages: Math.ceil(totalTransaction / limit),
            currentPage: parseInt(page),
            transactionsData
        });

        // res.status(200).json(transactionsData);
    } catch  (error) {
        console.log(error)
        return res.status(500).json({ error: error.message });  // Handle any errors that occur
    }
};

exports.markTransactionAsProcessed = async (req, res) => {
    const { qr } = req.params;  // Assuming qr is passed as a URL parameter

    try {
        const document = await Transaction.findOne({ couponCode:  qr });
        if(document.isProcessed) {
            return res.status(404).json({ message: 'Coupon Redeemed already.' });
        } else {
            // Find the transaction and update isProcessed to true
            const updatedTransaction = await Transaction.findOneAndUpdate(
                {couponCode: qr},  // Match the QR code
                {isProcessed: true, updatedBy: req.user._id, redeemedBy: req.user._id.toString()},  // Update isProcessed to true
                {new: true}  // Return the updated document
            );
            let batch = {};
            if (updatedTransaction.isProcessed) {
                let getTransaction = await Transaction.findOne({couponCode: qr})
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
                        return res.status(404).json({ message: 'User not found for update.' });
                    }
                }
            }

            if (!updatedTransaction) {
                return res.status(404).json({message: 'Transaction not found.'});
            }

            const data = {
                // qr_code_id: updatedTransaction.qr_code_id,
                isProcessed: updatedTransaction.isProcessed,
                redeemablePoints: updatedTransaction.redeemablePoints,
                couponCode: document.couponCode,
                cash: batch.value,
                batchName: batch.Branch,
                batchNumber: batch.BatchNumber,
            }

            return res.status(200).json({message: "Coupon redeemed Successfully..!", data: data});
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: error.message });
    }
};

exports.scanQRCode = async (req, res) => {
    try {
        const { mobile } = req.body;
        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        const transaction = await Transaction.findOne({ qr_code_id: req.query.qr });
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found.' });
        }
        if (transaction.isProcessed) {
            return res.status(400).json({ message: 'Coupon already redeemed.' });
        }
        const updatedTransaction = await Transaction.findOneAndUpdate(
            { qr_code_id: req.query.qr },
            { isProcessed: true, updatedBy: user._id, redeemedBy: user._id },
            { new: true }
        );
        return res.status(200).json({ message: 'Coupon redeemed Successfully..!' });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: error.message });
    }
};
