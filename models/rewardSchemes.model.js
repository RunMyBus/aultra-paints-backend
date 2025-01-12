const mongoose = require('mongoose');

const rewardSchemesSchema = new mongoose.Schema({
    rewardSchemeImageUrl: { type: String },
    rewardSchemeStatus: { type: String, required: true },
    updatedBy: { type: String },
    createdBy: { type: String },
}, { timestamps: true });

const rewardSchemes = mongoose.model('rewardSchemes', rewardSchemesSchema, 'rewardSchemes');

module.exports = rewardSchemes;