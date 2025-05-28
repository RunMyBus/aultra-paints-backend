const mongoose = require('mongoose');

const oldBrandSchema = new mongoose.Schema({
  proId: { type: String, required: true },
  brands: { type: String, required: true },
});

module.exports = mongoose.model('OldBrand', oldBrandSchema, 'oldbrands');
