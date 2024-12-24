const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Branch Schema
const BranchSchema = new Schema(
  {
    Branch: { type: String, required: true },      // Branch Name as a String
    CreationDate: { type: Date, required: true },  // Creation date of the branch
    ExpiryDate: { type: Date, required: true },    // Expiry date for products
    BatchNumber: { type: String, required: true }, // Batch number for products
    Brand: { type: String, required: true },       // Brand name
    ProductName: { type: String, required: true }, // Name of the product
    Volume: { type: Number, required: true },      // Volume of the product
    Quantity: { type: String, required: true }     // Quantity in stock
  },
  {
    timestamps: true // Automatically adds `createdAt` and `updatedAt` fields
  }
);

// Create the Branch model
const Branch = mongoose.model('Branch', BranchSchema);

// Export the Branch model
module.exports = Branch;
