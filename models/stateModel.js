const mongoose = require('mongoose');

const stateSchema = new mongoose.Schema({
    stateName: { 
        type: String, 
        required: true, 
    },
    stateId: { 
        type: String, 
        required: true, 
    }
}, { timestamps: true });

const State = mongoose.model('State', stateSchema);

module.exports = State;
