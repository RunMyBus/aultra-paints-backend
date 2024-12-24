const mongoose = require('mongoose');


const transactionSchema = new mongoose.Schema({
    transactionId: { type: String, required: true, unique: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    qr_code: { type: String, required: true, unique: true },
    couponValue: { type: Number },
    points: { type: Number },
    redeemedBy: { type: String },// user who redeemed this coupon
    qr_code: { type: String, required: true, unique: true },
    isProcessed: { type: Boolean, default: false }  // Default set to false
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
