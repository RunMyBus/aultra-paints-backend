const mongoose = require('mongoose');


const transactionSchema = new mongoose.Schema({
    transactionId: { type: String, required: true, unique: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    qr_code_id: {type: String},
    qr_code: { type: String, required: true, unique: true },
    couponValue: { type: Number },
    points: { type: Number },
    redeemablePoints: { type: Number },
    value: { type: Number },
    couponCode: { type: Number },
    redeemedBy: { type: String },// user who redeemed this coupon
    redeemedByMobile: { type: String },
    UDID: { type: String },
    isProcessed: { type: Boolean, default: false },  // Default set to false
    pointsRedeemedBy: { type: String },
    cashRedeemedBy: { type: String }
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
