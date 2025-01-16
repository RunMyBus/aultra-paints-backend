const mongoose = require('mongoose');

const staticPhoneNumbersSchema = new mongoose.Schema({
    mobile: {type: String}
}, {timestamps: true})

const StaticPhoneNumbers = mongoose.model('StaticPhoneNumbers', staticPhoneNumbersSchema, 'staticPhoneNumbers');

module.exports = StaticPhoneNumbers;