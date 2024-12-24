const mongoose = require('mongoose');
const Batch = require('../models/batchnumber');

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
      return savedBatchNumber;
    });
    
    const savedBatchNumbers = await Promise.all(BatchNumberPromises);
    res.status(201).json(savedBatchNumbers);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Error saving branch and products', error: error.message });
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

