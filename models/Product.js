// models/product.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Define the schema for the product
const productSchema = new Schema({
  batchNumber: { type: String, required: true },
  brand: { type: String, required: true },
  productName: { type: String, required: true },
  volume: { type: Number, required: true },
  quantity: { type: Number, required: true },
  Branch: {type:String, required:true},
  creationDate: { type: Date, default: Date.now },
  expiryDate: { type: Date, required: true },
});

// Create and export the model
const Product = mongoose.model('Product', productSchema);
module.exports = Product;
