const mongoose = require('mongoose');

const couponCodesSchema = new mongoose.Schema({
    couponSeries: { type: Number },
    udid: { type: String },
    consumed: {type: Boolean, default: false}
});

const CouponCodes = mongoose.model('CouponCodes', couponCodesSchema, 'couponCodes');

module.exports = CouponCodes;