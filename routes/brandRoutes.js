const express = require('express');
const {
  createBrand,
  getBrands,
  getBrandByName,
  updateBrand,
  deleteBrand,
  getAllBrands
} = require('../controllers/brandController');

const router = express.Router();

// Create a new brand
router.post('/', createBrand);

// Get all brands with pagination
router.get('/', getBrands);

// Get all brands without pagination
router.get('/getAllBrands', getAllBrands);

// Search brand(s) by name with pagination
router.get('/search/:name', getBrandByName);

// Update a brand by ID
router.put('/:id', updateBrand);

// Delete a brand by ID
router.delete('/:id', deleteBrand);

module.exports = router;
