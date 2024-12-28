const mongoose = require("mongoose");

const  { schema, model} = mongoose;

const sequenceSchema = new mongoose.Schema({
    name: String, value: Number, date: String
  },
  { timestamps: true }
);

let Sequence = (module.exports = mongoose.model('Sequence', sequenceSchema, 'sequence'));

