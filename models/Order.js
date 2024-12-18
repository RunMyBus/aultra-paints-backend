// models/Order.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Define the schema for the product
const orderSchema = new Schema({
  brand: { type: String, required: true },
  productName: { type: String, required: true },
  volume: { type: Number, required: true },
  quantity: { type: Number, required: true }
}, { timestamps: true });
orderSchema.plugin(createdUpdatedPlugin);

function createdUpdatedPlugin(schema, options) {
  schema.add({
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
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

// Create and export the model
const order = mongoose.model('order', orderSchema);

module.exports = order;
