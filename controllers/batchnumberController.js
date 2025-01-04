const mongoose = require('mongoose');
const Batch = require('../models/batchnumber');
const Transaction = require('../models/Transaction');
const sequenceModel = require('../models/sequence.model');
const {v4: uuidv4} = require('uuid');
const AWS = require('aws-sdk');
const QRCode = require('qrcode');
const {ObjectId} = require("mongodb");
// const {config} = require("dotenv");

AWS.config.update({
    accessKeyId: config.AWS_ACCESS_KEY_Id,  // Replace with your access key
    secretAccessKey: config.AWS_SECRETACCESSKEY,  // Replace with your secret key
    region: config.REGION  // Replace with your AWS region
});

const s3 = new AWS.S3();

async function uploadQRCodeToS3(qrCodeData, key) {
    const params = {
        Bucket: 'aultra-paints',
        Key: key,
        Body: qrCodeData,
        ContentType: 'image/png',
    };

    try {
        await s3.putObject(params).promise();
        console.log('QR code uploaded to S3 successfully.');
        return `https://aultra-paints.s3.amazonaws.com/${key}`; // Return the S3 URL
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

        const date = new Date();
        const curMonth = date.getMonth() + 1;
        const curYear = date.getFullYear();
        const curYearMonth = `${curYear}-${curMonth.toString().padStart(2, "0")}`;

        // Validate inputs
        if (!req.body.BatchNumbers || !Array.isArray(req.body.BatchNumbers)) {
            return res.status(400).json({error: "BatchNumbers must be an array."});
        }

        // Process each batch number in the request
        const BatchNumberPromises = req.body.BatchNumbers.map(async (product, index) => {
            const startOfMonth = new Date(req.body.CreationDate);
            startOfMonth.setDate(1);
            const endOfMonth = new Date(startOfMonth);
            endOfMonth.setMonth(endOfMonth.getMonth() + 1);

            // Check for existing batch
            const existingBatch = await Batch.findOne({
                Branch: req.body.branchName,
                BatchNumber: product.BatchNumber,
                CreationDate: {$gte: startOfMonth, $lt: endOfMonth},
            });

            if (existingBatch) {
                throw new Error(
                    `Batch number ${product.BatchNumber} already exists for branch ${req.body.branchName} within the current month`
                );
            }

            // Create and save batch
            const newBatchNumber = new Batch({
                Branch: req.body.Branch,
                CreationDate: req.body.CreationDate,
                ProductName: req.body.ProductName,
                ExpiryDate: req.body.ExpiryDate,
                BatchNumber: product.BatchNumber,
                Brand: product.Brand,
                value: product.value,
                Volume: product.Volume,
                Quantity: product.Quantity,
                RedeemablePoints: product.redeemablePoints,
                CouponSeries: product.CouponSeries,
            });

            const savedBatchNumber = await newBatchNumber.save();

            // Generate transactions
            const transactionPromises = Array.from(
                {length: product.Quantity},
                async (_, i) => {
                    const couponCode = product.CouponSeries + i;
                    const qrCodeId = uuidv4();
                    const customUrl = `${config.redeemUrl}/redeem.html?qrCodeId=${qrCodeId}`;
                    const qrCodeData = await QRCode.toBuffer(customUrl);
                    const qrCodeKey = `${savedBatchNumber._id}-${qrCodeId}.png`;
                    const qrCodeUrl = await uploadQRCodeToS3(qrCodeData, qrCodeKey);

                    const transaction = new Transaction({
                        transactionId: uuidv4(),
                        batchId: savedBatchNumber._id,
                        redeemablePoints: product.redeemablePoints,
                        value: product.value,
                        qr_code: qrCodeUrl,
                        qr_code_id: qrCodeId,
                        couponCode: couponCode,
                        isProcessed: false,
                        createdBy: userId,
                    });

                    await transaction.save();
                }
            );

            await Promise.all(transactionPromises);
            return savedBatchNumber;
        });

        const savedBatchNumbers = await Promise.all(BatchNumberPromises);

        // Respond with success
        return res.status(200).json({
            message: "Branch and batches created successfully",
            batches: savedBatchNumbers,
        });
    } catch (error) {
        console.error(error);

        // Handle duplicate batch number error
        if (error.code === 11000 && error.keyPattern?.BatchNumber) {
            return res.status(409).json({
                message: "Duplicate BatchNumber encountered. Please retry.",
            });
        }

        return res.status(500).json({error: error.message});
    }
};

exports.getAllBatchNumbers = async (req, res) => {
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

