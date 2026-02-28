const mongoose = require('mongoose');

const transactionLedgerSchema = new mongoose.Schema({
    narration: { type: String, required: true },
    amount: { type: String },
    balance: { type: Number, required: true },
    userId: { type: String },
    couponId: { type: String },
    uniqueCode: { type: String, unique: true },
    creditNoteIssued: { type: Boolean, default: false }, // prevents double-deduction on repeated credit note downloads
},{ timestamps: true });

module.exports = mongoose.model('TransactionLedger', transactionLedgerSchema, 'transactionLedger');