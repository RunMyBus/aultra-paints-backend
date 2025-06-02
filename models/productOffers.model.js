const mongoose = require('mongoose');

const productOffersSchema = new mongoose.Schema({
    productOfferImageUrl: { type: String },
    productOfferDescription: { type: String, required: true },
    // productOfferTitle: { type: String, required: true }, -->
    validUntil: { type: Date },
    productOfferStatus: { type: String, required: true },
    updatedBy: { type: String },
    createdBy: { type: String },
    cashback: { type: Number, required: true, default: 0 }, 
    redeemPoints: { type: Number, required: true, default: 0 },
    price: [
        {
          volume: { type: String },
          refId: { type: String, required: true },
          price: { type: Number, required: true }
        }
    ],
    offerAvailable: { type: Boolean, default: true }
  
}, { timestamps: true });

const productOffers = mongoose.model('productOffers', productOffersSchema, 'productOffers');

module.exports = productOffers;
