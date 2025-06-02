const mongoose = require('mongoose');

const oldProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
});

module.exports = mongoose.model('OldProduct', oldProductSchema, 'oldproducts');
