// models/order.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Define the schema for the product
const orderSchema = new Schema({
  brand: { type: String, required: true },
  productName: { type: String, required: true },
  volume: { type: Number, required: true },
  quantity: { type: Number, required: true },
  createdBy: { type: String},
  createdAt: { type: Date, default: Date.now },
  updatedBy: { type: String},
  updatedAt: { type: Date, default: Date.now }
});

// Middleware to update 'updatedAt' on every save or update
orderSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});
// Create and export the model
const order = mongoose.model('order', orderSchema);
module.exports = order;
