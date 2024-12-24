const express = require('express');
const router = express.Router();
const batchnumberController = require('../controllers/batchnumberController');
const passport = require("passport");

router.use(passport.authenticate('jwt', { session: false }));


// GET all branches with pagination
router.get('/', batchnumberController.getAllBatchNumbers);

// GET a single branch by ID
router.get('/:BatchNumber',batchnumberController.getBranchByBatchNumber);

// POST to create a new branch with products
router.post('/', batchnumberController.createBatchNumber);

// PUT to update a branch by BatchNumber
router.put('/:BatchNumber', batchnumberController.updateBatchNumber);

// DELETE a branch/product by BatchNumber
router.delete('/:BatchNumber', batchnumberController.deleteBranchByBatchNumber);

module.exports = router;
