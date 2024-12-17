const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// Route for creating a new Product (POST)
router.post('/', productController.createProduct);

// Route for getting all Products (GET)
router.get('/', productController.getAllProducts );

module.exports = router;