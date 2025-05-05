const mongoose = require('mongoose');

const InvoiceTemplateSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    html: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('InvoiceTemplate', InvoiceTemplateSchema, 'InvoiceTemplate');