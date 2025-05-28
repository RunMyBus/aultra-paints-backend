const express = require('express');
const router = express.Router();

const {
  createProduct,
  getProductsByBrandId,
  getAllProducts,
  updateProduct,
  deleteProduct,
  getAllProductsForSelect,
  getProductsByName,
  getUnifiedProductList
} = require('../controllers/productController');

// Route to create a new product
router.post('/', createProduct);

// Route to get all products for a specific brand by brandId
router.get('/:brandId', getProductsByBrandId);

// Route to get all products with pagination and brand info
router.get('/', getAllProducts);

// Route to search products by product name
router.get('/search/:productName', getProductsByName);

// Route to update a product by its ID
router.put('/:id', updateProduct);

// Route to delete a product by its ID
router.delete('/:id', deleteProduct);

// Route to get all products for dropdown/select (based on brand)
router.get('/getAllProductsForSelect/:brandId', getAllProductsForSelect);

// Route to get unified product list
router.get('/unified-products', getUnifiedProductList);

module.exports = router;
