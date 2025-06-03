const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  brandId: { type: mongoose.Schema.Types.ObjectId, required: true },  
  products: { type: String, required: true },
});

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
