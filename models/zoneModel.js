const mongoose = require('mongoose');

const zoneSchema = new mongoose.Schema({
    zoneName: {
        type: String,
        required: true,
    },
    zoneId: {
        type: String,
        required: true,
    }
}, { timestamps: true });

const Zone = mongoose.model('Zone', zoneSchema);

module.exports = Zone;
