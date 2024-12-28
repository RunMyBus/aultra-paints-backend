const mongoose = require('mongoose');
const Batch = require('../models/batchnumber');
const Transaction = require('../models/Transaction');
const sequenceModel = require('../models/sequence.model');
const {v4: uuidv4} = require('uuid');
const AWS = require('aws-sdk');
const QRCode = require('qrcode');
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
        // const {
        //     Branch: branchName,
        //     CreationDate,
        //     ExpiryDate,
        //     BatchNumbers,
        //     CouponSeries,
        //     RedeemablePoints
        // } = req.body;

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
        const BatchNumberPromises = req.body.BatchNumbers.map(async (product) => {
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

            const sequenceDoc = await sequenceModel.findOneAndUpdate({name: "CouponSeries"}, [{$set: {value: {$add: ["$value", 1]},},}])

            const paddedSequence = await preFillZeros(sequenceDoc.value - 1, 4);

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
                CouponSeries: paddedSequence,
            });

            const savedBatchNumber = await newBatchNumber.save();

            // Generate transactions
            const transactionPromises = Array.from(
                {length: product.Quantity},
                async () => {
                    const qrCodeId = uuidv4();
                    const qrCodeData = await QRCode.toBuffer(qrCodeId);
                    const qrCodeKey = `${savedBatchNumber._id}-${qrCodeId}.png`;
                    const qrCodeUrl = await uploadQRCodeToS3(qrCodeData, qrCodeKey);

                    const transaction = new Transaction({
                        transactionId: uuidv4(),
                        batchId: savedBatchNumber._id,
                        qr_code: qrCodeUrl,
                        qr_code_id: qrCodeId,
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
                error: "Duplicate BatchNumber encountered. Please retry.",
            });
        }

        return res.status(500).json({error: error.message});
    }
};

exports.getAllBatchNumbers = async (req, res) => {
    // const {page = 1, limit = 10} = req.query;
    let page = parseInt(req.query.page || 1)
    let limit = parseInt(req.query.limit || 10)

    try {
        const branches = await Batch.find().skip((page - 1) * limit).limit(parseInt(limit)).exec();

        const totalBranches = await Batch.countDocuments();

        return res.status(200).json({
            total: totalBranches,
            pages: Math.ceil(totalBranches / limit),
            currentPage: parseInt(page),
            branches
        });
    } catch (error) {
        return res.status(500).json({message: 'Error retrieving branches', error: error.message});
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
    const {BatchNumber} = req.params;
    const updatedData = req.body;

    try {
        const updatedBranch = await Batch.findOne({BatchNumber});

        if (!updatedBranch) {
            return res.status(404).json({message: 'Branch with the given BatchNumber not found'});
        }


        Object.keys(updatedData).forEach((key) => {
            updatedBranch[key] = updatedData[key];
        });

        const savedBranch = await updatedBranch.save();
        res.status(200).json(savedBranch);

    } catch (error) {
        res.status(500).json({message: 'Error updating branch and product', error: error.message});
    }
};


// Delete a branch/product by BatchNumber
exports.deleteBranchByBatchNumber = async (req, res) => {
    const {BatchNumber} = req.params;

    try {
        const deletedBranch = await Batch.findOneAndDelete({BatchNumber});

        if (!deletedBranch) {
            return res.status(404).json({message: 'Branch/product not found'});
        }

        res.status(200).json({message: 'Branch/product deleted successfully'});
    } catch (error) {
        res.status(500).json({message: 'Error deleting branch/product', error: error.message});
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

