const mongoose = require('mongoose');

const transactionLedgerSchema = new mongoose.Schema({
    narration: { type: String, required: true },
    amount: { type: String },
    balance: { type: Number, required: true },
    userId: { type: String },
    couponId: { type: String },
    uniqueCode: { type: String, unique: true }, 
},{ timestamps: true });

module.exports = mongoose.model('TransactionLedger', transactionLedgerSchema, 'transactionLedger');