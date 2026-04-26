const mongoose = require('mongoose');

const creditNoteSchema = new mongoose.Schema({
    creditNoteNumber: { type: String, unique: true, required: true }, // CN-YYYYMM-NNNN
    userId:           { type: String, required: true },               // Dealer being debited
    balanceType:      { type: String, enum: ['rewardPoints', 'cash'], required: true },
    amount:           { type: Number, required: true, min: 1 },
    narration:        { type: String, maxlength: 200 },
    status:           { type: String, enum: ['issued', 'redeemed', 'cancelled'], default: 'issued' },
    ledgerId:         { type: String },                               // TransactionLedger._id
}, { timestamps: true });

creditNoteSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('CreditNote', creditNoteSchema, 'creditNotes');
