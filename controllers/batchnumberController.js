const mongoose = require('mongoose');
const Batch = require('../models/batchnumber');

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
exports.createBatchNumber = async (req, res) => {
  try {
    const { Branch: branchName, CreationDate, ExpiryDate, BatchNumbers } = req.body;

    const BatchNumberPromises = BatchNumbers.map(async (product) => {
      const existingBatch = await Batch.findOne({
        Branch: branchName,
        BatchNumber: product.BatchNumber
      });

      if (existingBatch) {
        throw new Error(`Batch number ${product.BatchNumber} already exists for branch ${branchName}`);
      }
      const newBatchNumber = new Batch({
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

    const savedBatchNumbers = await Promise.all(BatchNumberPromises);
    res.status(200).json(savedBatchNumbers);
    const batches = await Promise.all(BatchNumberPromises);
    res.status(200).json({ message: 'Branch and batches created successfully', batches });
  } catch (error) {
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
        return res.status(400).json({ message: 'Branch/product not found by BatchNumber' });
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

