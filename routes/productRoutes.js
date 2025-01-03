const express = require('express');
const { createProduct, getProducts,  getProductByName, updateProduct, deleteProduct } = require('../controllers/productController');
const router = express.Router();

// Create a new product
router.post('/', createProduct);

// Get all products
router.get('/', getProducts);

router.get('/getAllProducts', getAllProducts);

// Get a product by Name (new route for search)
router.get('/search/:name', getProductByName);  

// Update a product by ID
router.put('/:id', updateProduct);

// Delete a product by ID
router.delete('/:id', deleteProduct);

module.exports = router;
