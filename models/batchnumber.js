const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Branch Schema
const BatchNumberSchema = new Schema(
  {
      Branch: { type: String, required: true },
      CreationDate: { type: Date, required: true },
      ExpiryDate: { type: Date, required: true },
      BatchNumber: { type: String, required: true, unique: true },
      Brand: { type: String, required: true },
      ProductName: { type: String, required: true },
      value: { type: Number, required: true},
      Volume: { type: Number, required: true },
      Quantity: { type: Number, required: true },
      RedeemablePoints: { type: Number, default: 0, required: true },
      CouponSeries: { type: String, required: true, unique: true },
  },
  {
    timestamps: true 
  }
);

// Add index to enforce unique batch numbers within a month at a branch
BatchNumberSchema.index(
    { Branch: 1, BatchNumber: 1, CreationDate: 1 },
    {
        unique: true,
        partialFilterExpression: {
            CreationDate: { $exists: true },
            BatchNumber: { $exists: true },
            Branch: { $exists: true },
        },
    }
);

// Create the Branch model
const Batch = mongoose.model('BatchNumber', BatchNumberSchema);


module.exports = Batch;
