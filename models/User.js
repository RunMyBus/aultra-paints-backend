const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {type: String, required: true},
    email: {type:String, required:true, unique:true},
    mobile: {type: String, required: true, required: 'mobile no required', unique: true,},
    password: {type:String, required:true},
    token: {type: String},
    redeemablePoints: {type: Number, default: 0},
    cash: {type: Number, default: 0},
}, {timestamps: true})

const User = mongoose.model('User', userSchema);

module.exports = User;
