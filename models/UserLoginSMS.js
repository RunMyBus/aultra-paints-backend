const mongoose = require('mongoose');

const userLoginSmsSchema = new mongoose.Schema({
    mobile: {type: String, required: true},
    otp: {type: Number, required: true},
    expiryTime: {type: Date, required: true},
    active: {type: Boolean, default: true}
}, {timestamps: true});

const UserLoginSMS = mongoose.model('UserLoginSMS', userLoginSmsSchema);

module.exports = UserLoginSMS;