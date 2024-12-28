// models/Brand.js
const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  proId: { type: String, required: true },  
  brands: { type: String, required: true },
});

const Brand = mongoose.model('Brand', brandSchema);

module.exports = Brand;
