const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {type: String, required: true},
    mobile: {type: String, required: true, required: 'mobile required', unique: true,},
    address: {type: String},

    token: {type: String}, //user login token
    rewardPoints: {type: Number, default: 0},
    cash: {type: Number, default: 0},
    status: { type: String, default: 'active' },
    primaryContactPerson: {type: String},
    primaryContactPersonMobile: {type: String},
    dealerCode: {type: String}, // valid only for dealer user type
    parentDealerCode: { type: String },  // valid only for painter user type
    accountType: { type: String, default: 'Painter'},
    upiID: { type: String },
    salesExecutive: {type: String}
}, {timestamps: true})

const User = mongoose.model('User', userSchema);

module.exports = User;
