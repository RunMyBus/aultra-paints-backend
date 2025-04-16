const mongoose = require('mongoose');

const productCatlogPriceSchema = new mongoose.Schema({ 
    productcatlogId: { type: String, required: true }, 
    dealerId: { type: String, required: true },
    price: { type: Number, required: true }
}, { timestamps: true });

const ProductCatlogPrice = mongoose.model('ProductCatlogPrice', productCatlogPriceSchema, 'productCatlogPrices');

module.exports = ProductCatlogPrice;
