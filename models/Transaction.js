const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    batchId: {type: Number, required: true, unique: true},
    qr_code: {type: String, required: true, unique: true},
    isProcessed: {type: Boolean, required: false}
}, {timestamps: true});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;