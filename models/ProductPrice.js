const mongoose = require('mongoose');

const productPriceSchema = new mongoose.Schema({
    productOfferId: { type: String, required: true },
    dealerId: { type: String, required: true },
    price: { type: Number, required: true },
    volume: { type: String }
}, {timestamps: true})

productPriceSchema.index({ productOfferId: 1, dealerId: 1 });
productPriceSchema.index({ productOfferId: 1 });

const ProductPrice = mongoose.model('ProductPrice', productPriceSchema, 'productPrices');

module.exports = ProductPrice;
