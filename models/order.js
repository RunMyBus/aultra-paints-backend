// models/order.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Define the schema for the product
const orderSchema = new Schema({
  brand: { type: String, required: true },
  productName: { type: String, required: true },
  volume: { type: Number, required: true },
  quantity: { type: Number, required: true }
});

// Create and export the model
const order = mongoose.model('order', orderSchema);
module.exports = order;
