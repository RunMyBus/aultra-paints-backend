const mongoose = require('mongoose');

const productCatlogSchema = new mongoose.Schema({
  productImageUrl: { type: String },
  productDescription: { type: String, required: true },
  productStatus: { type: String, required: true },
  updatedBy: { type: String },
  createdBy: { type: String },
  price: [
    {
      refId: { type: String, required: true },
      price: { type: Number, required: true }
    }
  ]
}, { timestamps: true });

module.exports = mongoose.model('ProductCatlog', productCatlogSchema);
