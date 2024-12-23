const mongoose = require('mongoose');
const Branch = require('../models/branch');
const Transaction = require('../models/Transaction');
const { v4: uuidv4 } = require('uuid');

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
      const transactionPromises = Array.from({ length: product.Quantity }, () => {
        const qrCode = uuidv4();  // Generate unique QR
        return new Transaction({
          batchId: savedBatchNumber._id,  // Use the new batch ID
          qr_code: qrCode,
          isProcessed: false
        }).save();
      });

      await Promise.all(transactionPromises);
      return savedBatchNumber;
    });



    // Wait for all batch numbers to be saved
    const savedBatchNumbers = await Promise.all(BatchNumberPromises);
    res.status(201).json(savedBatchNumbers);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Error saving branch and products', error: error.message });
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

