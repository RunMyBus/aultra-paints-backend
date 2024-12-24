// controllers/branchController.js
const Branch = require('../models/branch');  // Ensure correct path

// Create a new branch with products
exports.createBranch = async (req, res) => {
    try {
        const { Branch: branchName, CreationDate, ExpiryDate, Products } = req.body;

        const newBranch = new Branch({
            Branch: branchName,  
            CreationDate,
            ExpiryDate,
            Products
        });

        await newBranch.save();
        res.status(201).json({
            message: 'Branch and products added successfully',
            branch: newBranch
        });
    } catch (error) {
        res.status(500).json({ message: 'Error saving branch', error: error.message });
    }
};

// Get all branches with their products flattened
exports.getAllBranches = async (req, res) => {
    try {
        const branches = await Branch.find(); // Fetch all branches from DB
        let response = [];

        branches.forEach(branch => {
            // Flatten products and merge each product with its branch data
            branch.Products.forEach(product => {
                response.push({
                    _id: branch._id,
                    Branch: branch.Branch,
                    CreationDate: branch.CreationDate,
                    ExpiryDate: branch.ExpiryDate,
                    BatchNumber: product.BatchNumber,
                    Brand: product.Brand,
                    ProductName: product.ProductName,
                    Volume: product.Volume,
                    Quantity: product.Quantity,
                    __v: branch.__v
                });
            });
        });

        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching branches', error: error.message });
    }
};

// Update a product in a branch by BatchNumber
exports.updateBranch = async (req, res) => {
    try {
        const { Quantity, ProductName, Volume, Brand } = req.body;
        const batchNumberParam = req.params.batchNumber;  

        const updatedBranch = await Branch.findOneAndUpdate(
            { "Products.BatchNumber": batchNumberParam },  
            {
                $set: {
                    "Products.$.Quantity": Quantity,         
                    "Products.$.ProductName": ProductName,    
                    "Products.$.Volume": Volume,              
                    "Products.$.Brand": Brand                 
                }
            },
            { new: true } 
        );

        if (!updatedBranch) {
            return res.status(404).json({ message: 'Branch with the specified BatchNumber not found' });
        }

        res.status(200).json({
            message: 'Product updated successfully',
            branch: updatedBranch
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error updating branch', error: error.message });
    }
};

// Delete a product in a branch by BatchNumber
exports.deleteBranch = async (req, res) => {
    try {
        const batchNumberParam = req.params.batchNumber;  

        const updatedBranch = await Branch.findOneAndUpdate(
            { "Products.BatchNumber": batchNumberParam },  
            { $pull: { Products: { BatchNumber: batchNumberParam } } },  
            { new: true } 
        );

        if (!updatedBranch) {
            return res.status(404).json({ message: 'Branch with the specified BatchNumber not found' });
        }

        res.status(200).json({
            message: 'Product deleted successfully',
            branch: updatedBranch
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error deleting product from branch', error: error.message });
    }
};
