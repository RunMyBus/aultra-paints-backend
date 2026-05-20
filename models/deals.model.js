const mongoose = require('mongoose');
const { Schema } = mongoose;

const dealsSchema = new mongoose.Schema({
    title:          { type: String, required: true, trim: true, maxlength: 120 },
    description:    { type: String, trim: true, maxlength: 1000 },
    dealImageUrl:   { type: String, required: true },
    expirationDate: { type: Date, required: true },
    active:         { type: Boolean, required: true, default: true },
    category:       { type: Schema.Types.ObjectId, ref: 'ProductCategory', required: true },
    createdBy:      { type: String },
    updatedBy:      { type: String },
}, { timestamps: true });

// Compound index powers the per-dealer active-deals query.
dealsSchema.index({ active: 1, expirationDate: 1, category: 1 });

const Deal = mongoose.model('Deal', dealsSchema, 'deals');

module.exports = Deal;
