const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {type: String, required: true},
    // email: {type:String, unique:true},
    mobile: {type: String, required: true, required: 'mobile required', unique: true,},
    password: {type:String},
    token: {type: String},
    redeemablePoints: {type: Number, default: 0},
    cash: {type: Number, default: 0},
    status: { type: String, default: 'inactive' },

    address: {type: String},

    primaryContactPerson: {type: String},
    primaryContactPersonMobile: {type: String},

    dealerCode: {type: String},
    // parentDealer: {type: String},

    accountType: { type: String, default: 'Painter'}
}, {timestamps: true})

const User = mongoose.model('User', userSchema);

module.exports = User;
