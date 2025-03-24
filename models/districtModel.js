const mongoose = require('mongoose');

const districtSchema = new mongoose.Schema({
    districtName: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    districtId: {
        type: String,
        required: true,
        unique: true,
        trim: true
    }
}, { timestamps: true });

const District = mongoose.model('District', districtSchema);

module.exports = District;
