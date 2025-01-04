const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {type: String, required: true},
    email: {type:String, unique:true},
    mobile: {type: String, required: true, required: 'mobile required', unique: true,},
    password: {type:String, required:true},
    token: {type: String},
    redeemablePoints: {type: Number, default: 0},
    cash: {type: Number, default: 0},
    status: { type: String, default: 'inactive' },

    address: {type: String, required: 'Address required'},

    primaryContactPerson: {type: String, required: true},
    primaryContactPersonMobile: {type: String, required: true},

    dealerCode: {type: String, required: true, unique: true},
    parentDealer: {type: String},

    accountType: { type: String, default: 'Painter'}
}, {timestamps: true})

const User = mongoose.model('User', userSchema);

module.exports = User;
