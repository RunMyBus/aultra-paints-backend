// models/Order.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const OrderItemSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Reference to productOffer or productCatalog
  productOfferDescription: { type: String, required: true },
  productPrice: { type: Number, required: true },
  quantity: { type: Number, required: true },
  volume: { type: String, required: true },
});

function createdUpdatedPlugin(schema, options) {
  schema.add({
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    dealerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  });

  schema.pre('save', function (next) {
    if (this.isNew) {
      this.updatedBy = this.createdBy;
    }
    next();
  });

  schema.pre('findOneAndUpdate', function (next) {
    const userId = this.options.context?.userId;
    if (userId) {
      this.getUpdate().updatedBy = userId;
    }
    next();
  });
}

// Define the schema for the order
const orderSchema = new Schema({
  orderId: { type: String, required: true, index: true },
  items: { type: [ OrderItemSchema ], required: true },
  totalPrice: { type: Number, required: true },
  gstPrice: { type: Number, required: true },
  finalPrice: { type: Number, required: true },
  status: { type: String, required: true, default: 'PENDING' },
  isVerified: { type: Boolean, default: false },
  isRejected: { type: Boolean, default: false },
}, { timestamps: true });
orderSchema.plugin(createdUpdatedPlugin);

// Create and export the model
const order = mongoose.model('order', orderSchema);

module.exports = order;
