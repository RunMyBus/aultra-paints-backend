const mongoose = require('mongoose');


const transactionSchema = new mongoose.Schema({
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    qr_code: { type: String },
    redeemablePoints: { type: Number },
    value: { type: Number },
    couponCode: { type: Number },
    UDID: { type: String },
    isProcessed: { type: Boolean, default: false },  // Default set to false
    pointsRedeemedBy: { type: String },
    cashRedeemedBy: { type: String },
    pointsRedeemedAt: { type: Date },
    cashRedeemedAt: { type: Date },
    upiId: { type: String },
}, { timestamps: true });

transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ batchId: 1, createdAt: -1 });
transactionSchema.index({ couponCode: 1 });
transactionSchema.index({ UDID: 1 });
transactionSchema.index({ pointsRedeemedBy: 1 });
transactionSchema.index({ cashRedeemedBy: 1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
