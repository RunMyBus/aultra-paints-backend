const mongoose = require('mongoose');

const userPointsSchema = new mongoose.Schema({
    userId: {type: String, required: true},
    transactionId: {type:String, required:true}
}, {timestamps: true})

const UserPoints = mongoose.model('UserPoints', userPointsSchema);

module.exports = UserPoints;
