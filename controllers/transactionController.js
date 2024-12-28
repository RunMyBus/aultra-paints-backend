const Transaction = require('../models/Transaction');
const mongoose = require("mongoose");
const Batch = require("../models/batchnumber");
const User = require('../models/User');
const sequenceModel = require("../models/sequence.model");

exports.getAllTransactionsForBatch = async (req, res) => {
    // console.log(req.body)
    try {
        let page = parseInt(req.body.page || 1);
        let limit = parseInt(req.body.limit || 10);
        const { batchId } = req.body;
        let query = {};
        if (batchId)
            query.batchId = new ObjectId(batchId);
        let querySet = [
            { $match: { } },
            { $addFields: { batchId: { $toObjectId: "$batchId" } } },
            { $lookup: { from: 'batchnumbers', localField: 'batchId', foreignField: '_id', as: 'batchData' } },
            { $unwind: '$batchData' },

            { $addFields: { createdBy: { $toObjectId: "$createdBy" } } },
            { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'userData' } },
            { $unwind: '$userData' },

            // { $addFields: { updatedBy: { $toObjectId: "$updatedBy" } } },
            { $addFields: { updatedBy: { $cond: { if: { $eq: ["$updatedBy", null] }, then: null, else: { $toObjectId: "$updatedBy" } } } } },
            { $lookup: { from: 'users', localField: 'updatedBy', foreignField: '_id', as: 'uploadData' } },
            { $unwind: { path: '$uploadData', preserveNullAndEmptyArrays: true } }, // Allow null/empty `updatedBy`
            {
                $project: {
                    _id: 1,
                    transactionId: 1,
                    batchId: 1,
                    batchName: '$batchData.Branch',
                    createdByName: { $ifNull: ['$userData.name', ''] },
                    updatedByName: { $ifNull: ['$uploadData.name', ''] },
                    createdBy: 1,
                    updatedBy: 1,
                    qr_code_id: 1,
                    qr_code: 1,
                    couponValue: 1,
                    points: 1,
                    redeemedBy: 1,
                    isProcessed: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    data: '$uploadData'
                }
            },
            { $skip: ((page - 1) * limit) },
            { $limit: limit },
        ];
        const transactionsData = await Transaction.aggregate(querySet)
        const totalTransaction = await Transaction.countDocuments();
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
        const document = await Transaction.findOne({ qr_code_id:  qr });
        if(document.isProcessed) {
            return res.status(404).json({ message: 'Coupon Redeemed already.' });
        }else {
            // Find the transaction and update isProcessed to true
            const updatedTransaction = await Transaction.findOneAndUpdate(
                {qr_code_id: qr},  // Match the QR code
                {isProcessed: true, updatedBy: req.user._id},  // Update isProcessed to true
                {new: true}  // Return the updated document
            );

            if (updatedTransaction.isProcessed) {
                let getTransaction = await Transaction.findOne({qr_code_id: qr})
                let batch = await Batch.findOne({_id: getTransaction.batchId});
                // const sequenceDoc = await sequenceModel.findOneAndUpdate({name: "CouponSeries"}, [{$set: {value: {$add: ["$value", 1]},},}])
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

            return res.status(200).json({message: "Coupon redeemed Successfully..!"});
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: error.message });
    }
};
