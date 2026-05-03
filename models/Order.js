// models/Order.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const OrderItemSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, required: true }, // Reference to productOffer or productCatalog
  productOfferDescription: { type: String, required: true },
  productPrice: { type: Number, required: true },
  quantity: { type: Number, required: true },
  volume: { type: String, required: true },
  focusProductId: { type: Number },
  focusUnitId: { type: Number },
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
  items: { type: [OrderItemSchema], required: true },
  totalPrice: { type: Number, required: true },
  gstPrice: { type: Number, required: true },
  finalPrice: { type: Number, required: true },
  status: { type: String, required: true, default: 'PENDING' },
  isVerified: { type: Boolean, default: false },
  isRejected: { type: Boolean, default: false },

  // Status History
  statusHistory: [{
    status: { type: String, required: true },
    changedAt: { type: Date, default: Date.now }
  }],

  // Sales order context (user-selected in mobile app)
  entityId: { type: Number },
  warehouseId: { type: Number },
  branchId: { type: Number },
  narration: { type: String },

  // Focus Integration Fields
  focusSyncStatus: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED'], default: 'PENDING' },
  focusOrderId: { type: String }, // SO VoucherNo returned by Focus
  focusDCInvoiceId: { type: [String], default: [] }, // DC VoucherNo(s) from delivery challan
  focusSyncResponse: { type: Object }
}, { timestamps: true });
orderSchema.plugin(createdUpdatedPlugin);

// Create and export the model
const order = mongoose.model('order', orderSchema);

module.exports = order;
