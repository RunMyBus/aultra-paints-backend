const mongoose = require('mongoose');
const Branch = require('../models/branch');
const Transaction = require('../models/Transaction');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');

AWS.config.update({
  accessKeyId: 'YOUR_ACCESS_KEY',  // Replace with your access key
  secretAccessKey: 'YOUR_SECRET_KEY',  // Replace with your secret key
  region: 'YOUR_REGION'  // Replace with your AWS region
});

const s3 = new AWS.S3();

const uploadQRCodeToS3 = async (qrCode) => {
  const buffer = await QRCode.toBuffer(qrCode, { errorCorrectionLevel: 'H' });  // Generate QR code buffer

  const params = {
    Bucket: 'YOUR_BUCKET_NAME',  // Replace with your S3 bucket name
    Key: `qrcodes/${qrCode}.png`,  // File name for the QR code image
    Body: buffer,  // The buffer containing the image
    ContentType: 'image/png',  // Content type for the image
    ACL: 'public-read'  // Make it publicly readable
  };

  return s3.upload(params).promise();
};

// Create a new branch with products
exports.createBranch = async (req, res) => {
  try {
    const { Branch: branchName, CreationDate, ExpiryDate, BatchNumbers } = req.body;

    const BatchNumberPromises = BatchNumbers.map(async (product) => {
      // Check if a record with the same branch name and batch number already exists
      const existingBatch = await Branch.findOne({
        Branch: branchName,
        BatchNumber: product.BatchNumber
      });

      if (existingBatch) {
        // If a batch with the same branch name and batch number exists, throw an error
        throw new Error(`Batch number ${product.BatchNumber} already exists for branch ${branchName}`);
      }

      // If no existing batch found, create a new batch entry
      const newBatchNumber = new Branch({
        Branch: branchName,
        CreationDate,
        ExpiryDate,
        BatchNumber: product.BatchNumber,
        Brand: product.Brand,
        ProductName: product.ProductName,
        Volume: product.Volume,
        Quantity: product.Quantity
      });

      const savedBatchNumber = await newBatchNumber.save();

      // Generate transactions based on Quantity
      const transactionPromises = Array.from({ length: product.Quantity }, async () => {
        const qrCode = uuidv4();  // Generate unique QR
        await uploadQRCodeToS3(qrCode);  // Save QR code to S3
        const transactionId = uuidv4();  // Generate unique transaction ID

        const transaction = new Transaction({
          transactionId,  // Unique transaction ID
          batchId: savedBatchNumber._id,  // Reference to batch ID
          qr_code: qrCode,  // Save the generated QR code
          isProcessed: false  // Default is false
        });

        await transaction.save();  // Save each transaction
      });

      await Promise.all(transactionPromises);  // Wait for all transactions to be saved
      return savedBatchNumber;
    });

    const batches = await Promise.all(BatchNumberPromises);
    res.status(200).json({ message: 'Branch and batches created successfully', batches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get all branches with pagination
exports.getAllBranches = async (req, res) => {
  const { page = 1, limit = 10 } = req.query; // Default to page 1 and 10 items per page

  try {
    const branches = await Branch.find()
      .skip((page - 1) * limit) // Skip items for the current page
      .limit(parseInt(limit)) // Limit the number of items returned
      .exec();

    const totalBranches = await Branch.countDocuments(); // Total count for pagination metadata

    res.status(200).json({
      total: totalBranches,
      pages: Math.ceil(totalBranches / limit), // Calculate total pages
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
      const branch = await Branch.findOne({ BatchNumber });
  
      if (!branch) {
        return res.status(404).json({ message: 'Branch/product not found by BatchNumber' });
      }
  
      res.status(200).json(branch);
    } catch (error) {
      res.status(500).json({ message: 'Error retrieving branch by BatchNumber', error: error.message });
    }
  };
  
 // Update a branch by BatchNumber and all its product information
exports.updateBranch = async (req, res) => {
    const { BatchNumber } = req.params;  // Get BatchNumber from the request parameters
    const updatedData = req.body;        // Get all the fields to be updated from the request body
  
    try {
      // Find the branch by BatchNumber
      const updatedBranch = await Branch.findOne({ BatchNumber });
  
      if (!updatedBranch) {
        return res.status(404).json({ message: 'Branch with the given BatchNumber not found' });
      }
  
      // Update all the fields from the request body
      Object.keys(updatedData).forEach((key) => {
        updatedBranch[key] = updatedData[key];  // Dynamically update all fields
      });
  
      // Save the updated branch
      const savedBranch = await updatedBranch.save();
  
      // Return the full branch data (including the updated information)
      res.status(200).json(savedBranch);
  
    } catch (error) {
      res.status(500).json({ message: 'Error updating branch and product', error: error.message });
    }
  };
  

// Delete a branch/product by BatchNumber
exports.deleteBranchByBatchNumber = async (req, res) => {
  const { BatchNumber } = req.params;

  try {
    const deletedBranch = await Branch.findOneAndDelete({ BatchNumber });

    if (!deletedBranch) {
      return res.status(404).json({ message: 'Branch/product not found' });
    }

    res.status(200).json({ message: 'Branch/product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting branch/product', error: error.message });
  }
};

