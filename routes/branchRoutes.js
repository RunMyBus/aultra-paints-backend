const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branchController');

// Create a new branch with products
router.post('/', branchController.createBranch);

// Get all branches
router.get('/', branchController.getAllBranches);

// Update a product in a branch by BatchNumber
router.put('/:batchNumber', branchController.updateBranch);

// Delete a product in a branch by BatchNumber
router.delete('/:batchNumber', branchController.deleteBranch);

module.exports = router;
