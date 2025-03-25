const mongoose = require('mongoose');

const productPriceSchema = new mongoose.Schema({
    productOfferId: { type: String, required: true },
    dealerId: { type: String, required: true },
    price: { type: Number, required: true }
}, {timestamps: true})

const ProductPrice = mongoose.model('ProductPrice', productPriceSchema, 'productPrices');

module.exports = ProductPrice;
