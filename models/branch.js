// models/branch.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Product Schema (embedded inside the Branch Schema)
const productSchema = new Schema({
  BatchNumber: { type: String, required: true },
  Brand: { type: String, required: true },
  ProductName: { type: String, required: true },
  Volume: { type: Number, required: true },
  Quantity: { type: String, required: true }
});

// Branch Schema
const branchSchema = new Schema({
  Branch: { type: String, required: true },
  CreationDate: { type: Date, required: true },
  ExpiryDate: { type: Date, required: true },
  Products: [productSchema]  // Array of products for this branch
});

// Model creation
const Branch = mongoose.model('Branch', branchSchema);

// Export the model
module.exports = Branch;
