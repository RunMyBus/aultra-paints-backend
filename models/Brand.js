const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
});

const Brand = mongoose.model('Brand', brandSchema);

module.exports = Brand;
