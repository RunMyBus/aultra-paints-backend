const express = require('express');
const router = express.Router();
const batchnumberController = require('../controllers/batchnumberController');
const passport = require("passport");

router.use(passport.authenticate('jwt', { session: false }));


// GET all branches with pagination
router.post('/', batchnumberController.getAllBatchNumbers);

// GET a single branch by ID
router.get('batch/:BatchNumber', batchnumberController.getBranchByBatchNumber);

// POST to create a new branch with products
router.post('/add', batchnumberController.createBatchNumber);

// PUT to update a branch by BatchNumber
router.put('/update/:id', batchnumberController.updateBatchNumber);

// DELETE a branch/product by BatchNumber
router.delete('/:BatchNumber', batchnumberController.deleteBranchByBatchNumber);

// Get all distinct CouponSeries values
router.get('/couponSeries', batchnumberController.getCouponSeries);

module.exports = router;
