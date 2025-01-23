const mongoose = require('mongoose');

const transactionLedgerSchema = new mongoose.Schema({
    narration: { type: String, required: true },
    amount: { type: Number },
    balance: { type: Number, required: true },
    userId: { type: String },
    couponId: { type: String }
},{ timestamps: true });

module.exports = mongoose.model('TransactionLedger', transactionLedgerSchema, 'transactionLedger');