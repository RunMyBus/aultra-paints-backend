const mongoose = require('mongoose');
const Batch = require('../models/batchnumber');
const Transaction = require('../models/Transaction');
const sequenceModel = require('../models/sequence.model');
const {v4: uuidv4} = require('uuid');
const AWS = require('aws-sdk');
const QRCode = require('qrcode');
const {ObjectId} = require("mongodb");
// const {config} = require("dotenv");
const CouponCodes = require('../models/CouponCodes');
const s3 = require("../config/aws");
const logger = require('../utils/logger'); // Import the configured logger

async function uploadQRCodeToS3(qrCodeData, key) {
    const params = {
        Bucket: 'aultra-paints',
        Key: key,
        Body: qrCodeData,
        ContentType: 'image/png',
        ACL: 'public-read'
    };

    try {
        const response = await s3.upload(params).promise();
        console.log('QR code uploaded to S3 successfully.');
        return response.Location; // Return the S3 URL
    } catch (error) {
        console.error('Error uploading QR code to S3:', error);
        throw error;
    }
}

preFillZeros = async (number, length) => {
    return number.toString().padStart(length, '0');
}
// Create a new branch with products
exports.createBatchNumber = async (req, res) => {
    try {
        let userId = req.user.id.toString();
        const { Branch, ProductName, CreationDate, ExpiryDate, BatchNumbers, BatchNumber } = req.body;
        let successArray = [];
        let errorArray = [];
        for (let batchNumber of BatchNumbers) {
            const { CouponSeries, Brand, redeemablePoints, value, Volume, Quantity } = batchNumber;
            const batch = new Batch({
                Branch,
                ProductName,
                CreationDate,
                ExpiryDate,
                CouponSeries,
                Brand,
                RedeemablePoints: redeemablePoints,
                value,
                Volume,
                Quantity,
                BatchNumber,
            });
            let batchResult = {};
            try {
                batchResult = await batch.save();
                let transactions = [];
                // const batchId = batchResult._id;
                for (let i = 0; i < batchResult.Quantity; i++) {
                    const couponCode = batchResult.CouponSeries + i;
                    // const qrCodeId = uuidv4();
                    const customUrl = `${config.redeemUrl}/redeem.html?tx=${couponCode}`;
                    const qrCodeData = await QRCode.toBuffer(customUrl);
                    const qrCodeKey = `${batchResult._id}-${couponCode}.png`;
                    const qrCodeUrl = await uploadQRCodeToS3(qrCodeData, qrCodeKey);

                    const transaction = new Transaction({
                        transactionId: uuidv4(),
                        batchId: batchResult._id,
                        redeemablePoints: batchResult.RedeemablePoints,
                        value: batchResult.value,
                        qr_code: qrCodeUrl,
                        // qr_code_id: qrCodeId,
                        couponCode: couponCode,
                        isProcessed: false,
                        createdBy: userId,
                    });

                    const savedTransaction = await transaction.save();
                    await transactions.push(savedTransaction); // Push the saved transaction to the transactions array
                }
                batchResult.transactions = transactions;
                await successArray.push(batchResult);
            } catch (error) {
                console.error(error);
                if (batchResult._id) {
                    await Batch.deleteOne({ _id: batchResult._id });
                }
                errorArray.push({batchNumber, error: error.message});
            }
        }
        return res.status(200).json({ success: successArray, error: errorArray });
    } catch (error) {
        console.log(error)
        return res.status(500).json({error: error.message});
    }
}

exports.createBatchNumberWithCouponCheck = async (req, res) => {
    try {
        let userId = req.user.id.toString();
        const { Branch, ProductName, CreationDate, ExpiryDate, BatchNumbers, BatchNumber } = req.body;

        let successArray = [];
        let errorArray = [];

        for (let batchNumber of BatchNumbers) {
            const { CouponSeries, Brand, redeemablePoints, value, Volume, Quantity } = batchNumber;

            const startCouponSeries = parseInt(CouponSeries, 10);
            const endCouponSeries = startCouponSeries + Quantity - 1;

            try {
                // Fetch all coupons in the specified range
                const couponsInRange = await CouponCodes.find({
                    couponSeries: { $gte: startCouponSeries, $lte: endCouponSeries },
                });
                // Check if any coupon in the range is consumed
                const consumedCoupons = couponsInRange.filter(coupon => coupon.consumed === true);
                if (consumedCoupons.length > 0) {
                    return res.status(400).json({
                        error: `${CouponSeries} series already consumed.`,
                    });
                }
                // Ensure the requested quantity of coupons is available
                if (couponsInRange.length < Quantity) {
                    return res.status(400).json({
                        error: 'Not enough coupons are available.',
                    });
                }

                // Create the batch
                const batch = new Batch({
                    Branch,
                    ProductName,
                    CreationDate,
                    ExpiryDate,
                    CouponSeries,
                    Brand,
                    RedeemablePoints: redeemablePoints,
                    value,
                    Volume,
                    Quantity,
                    BatchNumber,
                });

                let batchResult = await batch.save();
                let transactions = [];

                for (let i = 0; i < couponsInRange.length; i++) {
                    const coupon = couponsInRange[i];
                    const customUrl = `${config.redeemUrl}/redeem.html?tx=${coupon.udid}`;
                    const qrCodeData = await QRCode.toBuffer(customUrl);
                    const qrCodeKey = `${batchResult._id}-${coupon.udid}.png`;
                    const qrCodeUrl = await uploadQRCodeToS3(qrCodeData, qrCodeKey);

                    const transaction = new Transaction({
                        transactionId: uuidv4(),
                        batchId: batchResult._id,
                        redeemablePoints: batchResult.RedeemablePoints,
                        value: batchResult.value,
                        qr_code: qrCodeUrl,
                        couponCode: coupon.couponSeries,
                        UDID: coupon.udid,
                        isProcessed: false,
                        createdBy: userId,
                    });

                    const savedTransaction = await transaction.save();
                    transactions.push(savedTransaction);

                    // Mark the coupon as consumed
                    await CouponCodes.updateOne({ _id: coupon._id }, { $set: { consumed: true } });
                }

                batchResult.transactions = transactions;
                successArray.push(batchResult);
            } catch (error) {
                console.error(error);
                errorArray.push({ batchNumber, error: error.message });
            }
        }

        return res.status(200).json({ success: successArray, error: errorArray });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
};

exports.getAllBatchNumbers = async (req, res) => {
    logger.info('Starting getAllBatchNumbers request', {
        page: req.body.page,
        limit: req.body.limit,
        searchQuery: req.body.searchQuery
    });
    try {
        const page = parseInt(req.body.page) || 1;
        const limit = parseInt(req.body.limit) || 10;
        const skip = (page - 1) * limit;

        // Build the match query
        let matchQuery = {};
        if (req.body.searchQuery) {
            const searchRegex = new RegExp(req.body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i");
            matchQuery = {
                $or: [
                    { Branch: { $regex: searchRegex } },
                    { BatchNumber: { $regex: searchRegex } }
                ]
            };
        }

        // Use aggregation pipeline
        const result = await Batch.aggregate([
            { $match: matchQuery }, // Filter documents
            {
                $facet: {
                    metadata: [{ $count: "total" }], // Count total documents
                    data: [
                        { $skip: skip }, // Skip for pagination
                        { $limit: limit } // Limit for pagination
                    ]
                }
            }
        ]);

        // Extract metadata and data
        const total = result[0]?.metadata[0]?.total || 0;
        const branches = result[0]?.data || [];

        return res.status(200).json({
            total,
            pages: Math.ceil(total / limit),
            currentPage: page,
            branches
        });
    } catch (error) {
        return res.status(500).json({ message: 'Error retrieving branches', error: error.message });
    }
};

exports.getAllBatchNumbers = async (req, res) => {
    try {
        const page = parseInt(req.body.page) || 1;
        const limit = parseInt(req.body.limit) || 10;
        const skip = (page - 1) * limit;

        let matchQuery = {};
        if (req.body.searchQuery) {
            const searchRegex = new RegExp(req.body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i");
            matchQuery = {
                $or: [
                    { Branch: { $regex: searchRegex } },
                    { BatchNumber: { $regex: searchRegex } }
                ]
            };
        }

        const result = await Batch.aggregate([
            { $match: matchQuery },
            {
                $addFields: {
                    brandId: {
                        $cond: {
                            if: { $regexMatch: { input: "$Brand", regex: /^[0-9a-fA-F]{24}$/ } },
                            then: { $toObjectId: "$Brand" },
                            else: null
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'brands',
                    localField: 'brandId',
                    foreignField: '_id',
                    as: 'brandsData'
                }
            },
            { $unwind: { path: '$brandsData', preserveNullAndEmptyArrays: true } },
            {
                $addFields: {
                    productId: {
                        $cond: {
                            if: { $regexMatch: { input: "$ProductName", regex: /^[0-9a-fA-F]{24}$/ } },
                            then: { $toObjectId: "$ProductName" },
                            else: null
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'products',
                    localField: 'productId',
                    foreignField: '_id',
                    as: 'productsData'
                }
            },
            { $unwind: { path: '$productsData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 1,
                    Branch: 1,
                    CreationDate: 1,
                    ExpiryDate: 1,
                    BatchNumber: 1,
                    Brand: 1,
                    BrandName: { $ifNull: ['$brandsData.brands', ''] },
                    ProductName: 1,
                    ProductNameStr: { $ifNull: ['$productsData.name', ''] },
                    value: 1,
                    Volume: 1,
                    Quantity: 1,
                    RedeemablePoints: 1,
                    CouponSeries: 1,
                }
            },
            { $sort: { createdAt: -1, _id: -1 } },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [
                        { $skip: skip },
                        { $limit: limit }
                    ]
                }
            }
        ]);

        const total = result[0]?.metadata[0]?.total || 0;
        const branches = result[0]?.data || [];

        return res.status(200).json({
            total,
            pages: Math.ceil(total / limit),
            currentPage: page,
            branches
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error retrieving branches', error: error.message });
    }
};

// Get a single branch by BatchNumber
exports.getBranchByBatchNumber = async (req, res) => {
    const {BatchNumber} = req.params;

    try {
        const branch = await Batch.findOne({BatchNumber});

        if (!branch) {
            return res.status(404).json({message: 'Branch/product not found by BatchNumber'});
        }

        res.status(200).json(branch);
    } catch (error) {
        res.status(500).json({message: 'Error retrieving branch by BatchNumber', error: error.message});
    }
};

// Update a branch by BatchNumber and all its product information
exports.updateBatchNumber = async (req, res) => {
    const id = req.params.id;
    const updatedData = req.body;

    try {
        const updatedBranch = await Batch.findOne({_id: new ObjectId(id)});

        if (!updatedBranch) {
            return res.status(404).json({message: 'Branch with the given BatchNumber not found'});
        }


        Object.keys(updatedData).forEach((key) => {
            updatedBranch[key] = updatedData[key];
        });

        const savedBranch = await updatedBranch.save();
        return res.status(200).json(savedBranch);

    } catch (error) {
        return res.status(500).json({message: 'Error updating branch and product', error: error.message});
    }
};

exports.branchDeletedAffectedCouponsCount = async (req, res) => {
    try {
        const couponCount = await Transaction.countDocuments({batchId: new ObjectId(req.params.id)});
        return res.status(200).json({message: `Batch deleted, ${couponCount} coupons affected.`});
    } catch (error) {
        console.log(error)
        return res.status(500).json({message: 'Error delete count', error: error.message});
    }
}


// Delete a branch/product by BatchNumber
exports.deleteBranchByBatchNumber = async (req, res) => {
    try {
        const deletedBranch = await Batch.findOneAndDelete({_id: new ObjectId(req.params.id)});
        if (!deletedBranch) {
            return res.status(404).json({message: 'Batch not found'});
        }
        return res.status(200).json({message: 'Batch deleted successfully'});
    } catch (error) {
        return res.status(500).json({message: 'Error deleting Batch', error: error.message});
    }
};

// Fetch all Batch Numbers and CouponSeries
// exports.getAllBatchNumbers = async (req, res) => {
//   try {
//     const batchNumbers = await Batch.find().select('BatchNumber Brand ProductName Volume Quantity CouponSeries');
//     res.status(200).json(batchNumbers);
//   } catch (error) {
//     res.status(500).json({ error: 'Failed to fetch batch numbers', details: error.message });
//   }
// };

// Fetch CouponSeries from BatchNumbers
exports.getCouponSeries = async (req, res) => {
    try {
        const batchNumbers = await Batch.find().distinct('CouponSeries');
        return res.status(200).json(batchNumbers);
    } catch (error) {
        console.log(err)
        return res.status(500).json({error: 'Failed to fetch coupon series', details: error.message});
    }
};

