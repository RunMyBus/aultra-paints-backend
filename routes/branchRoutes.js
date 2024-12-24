const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branchController');

// GET all branches with pagination
router.get('/', branchController.getAllBranches);

// GET a single branch by ID
router.get('/:BatchNumber', branchController.getBranchByBatchNumber);

// POST to create a new branch with products
router.post('/', branchController.createBranch);

// PUT to update a branch by BatchNumber
router.put('/:BatchNumber', branchController.updateBranch);

// DELETE a branch/product by BatchNumber
router.delete('/:BatchNumber', branchController.deleteBranchByBatchNumber);

module.exports = router;
