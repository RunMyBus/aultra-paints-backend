const express = require('express');
const { createProduct, getProducts, getProductById, updateProduct, deleteProduct } = require('../controllers/productController');
const router = express.Router();

// Create a new product
router.post('/', createProduct);

// Get all products
router.get('/', getProducts);

// Get a product by ID
router.get('/:id', getProductById);

// Update a product by ID
router.put('/:id', updateProduct);

// Delete a product by ID
router.delete('/:id', deleteProduct);

module.exports = router;
