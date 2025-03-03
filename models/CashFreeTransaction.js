const mongoose = require('mongoose');

const CashFreeTransactionSchema = new mongoose.Schema({
    transfer_id: { type: String },
    cf_transfer_id: { type: String },
    status: { type: String },
    status_code: { type: String },
    status_description: { type: String },
    beneficiary_details: { type: Object },
    currency: { type: String },
    transfer_amount: { type: Number },
    transfer_service_charge: { type: Number },
    transfer_service_tax: { type: Number },
    transfer_mode: { type: String },
    transfer_utr: { type: String },
    fundsource_id: { type: String },
    added_on: { type: String },
    updated_on: { type: String },
    event_time: { type: String },
    event_type: { type: String }
},{timestamps: true});

const CashFreeTransaction = mongoose.model('CashFreeTransaction', CashFreeTransactionSchema, 'cashFreeTransactions');

module.exports = CashFreeTransaction;
