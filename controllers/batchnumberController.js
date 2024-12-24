const mongoose = require('mongoose');
const Batch = require('../models/batchnumber');
const Transaction = require('../models/Transaction');
const { v4: uuidv4 } = require('uuid');
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

// Create a new branch with products
exports.createBatchNumber = async (req, res) => {
  try {
    const { Branch: branchName, CreationDate, ExpiryDate, BatchNumbers } = req.body;

    const BatchNumberPromises = BatchNumbers.map(async (product) => {
      const existingBatch = await Batch.findOne({
        Branch: branchName,
        BatchNumber: product.BatchNumber,
      });

      if (existingBatch) {
        throw new Error(
            `Batch number ${product.BatchNumber} already exists for branch ${branchName}`
        );
      }

      const newBatchNumber = new Batch({
        Branch: branchName,
        CreationDate,
        ExpiryDate,
        BatchNumber: product.BatchNumber,
        Brand: product.Brand,
        ProductName: product.ProductName,
        Volume: product.Volume,
        Quantity: product.Quantity,
      });

      const savedBatchNumber = await newBatchNumber.save();

      // Generate transactions based on Quantity
      const transactionPromises = Array.from({ length: product.Quantity }, async () => {
        const qrCodeId = uuidv4(); // Generate unique QR code ID
        const qrCodeData = await QRCode.toBuffer(qrCodeId); // QR code content is the unique ID
        const qrCodeKey = `${savedBatchNumber._id}-${qrCodeId}.png`;
        const qrCodeUrl = await uploadQRCodeToS3(qrCodeData, qrCodeKey);

        const transactionId = uuidv4(); // Generate unique transaction ID
        const transaction = new Transaction({
          transactionId,
          batchId: savedBatchNumber._id,
          qr_code: qrCodeUrl, // Save the S3 URL
          qr_code_id: qrCodeId, // Save the unique QR code ID
          isProcessed: false,
          createdBy: req.user._id
        });

        await transaction.save(); // Save each transaction
      });

      await Promise.all(transactionPromises); // Wait for all transactions to be saved
      return savedBatchNumber;
    });

    const savedBatchNumbers = await Promise.all(BatchNumberPromises);

    // Send a single response
    res.status(200).json({
      message: 'Branch and batches created successfully',
      batches: savedBatchNumbers,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};


exports.getAllBatchNumbers = async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  try {
    const branches = await Batch.find()
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .exec();

    const totalBranches = await Batch.countDocuments();

    res.status(200).json({
      total: totalBranches,
      pages: Math.ceil(totalBranches / limit),
      currentPage: parseInt(page),
      branches
    });
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving branches', error: error.message });
  }
};

// Get a single branch by BatchNumber
exports.getBranchByBatchNumber = async (req, res) => {
    const { BatchNumber } = req.params;

    try {
      const branch = await Batch.findOne({ BatchNumber });

      if (!branch) {
        return res.status(404).json({ message: 'Branch/product not found by BatchNumber' });
      }

      res.status(200).json(branch);
    } catch (error) {
      res.status(500).json({ message: 'Error retrieving branch by BatchNumber', error: error.message });
    }
  };

 // Update a branch by BatchNumber and all its product information
exports.updateBatchNumber = async (req, res) => {
    const { BatchNumber } = req.params;
    const updatedData = req.body;

    try {
      const updatedBranch = await Batch.findOne({ BatchNumber });

      if (!updatedBranch) {
        return res.status(404).json({ message: 'Branch with the given BatchNumber not found' });
      }


      Object.keys(updatedData).forEach((key) => {
        updatedBranch[key] = updatedData[key];
      });

      const savedBranch = await updatedBranch.save();
      res.status(200).json(savedBranch);

    } catch (error) {
      res.status(500).json({ message: 'Error updating branch and product', error: error.message });
    }
  };


// Delete a branch/product by BatchNumber
exports.deleteBranchByBatchNumber = async (req, res) => {
  const { BatchNumber } = req.params;

  try {
    const deletedBranch = await Batch.findOneAndDelete({ BatchNumber });

    if (!deletedBranch) {
      return res.status(404).json({ message: 'Branch/product not found' });
    }

    res.status(200).json({ message: 'Branch/product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting branch/product', error: error.message });
  }
};

