const Product = require('../models/Product');
const Brand = require('../models/Brand');
const OldProduct = require('../models/OldProduct');
const OldBrand = require('../models/OldBrand');

const getAllUnifiedProducts = async () => {
  // New data
  const newProducts = await Product.find();
  const newBrands = await Brand.find();
  const brandMap = {};
  newBrands.forEach(b => {
    brandMap[b._id.toString()] = b.name;
  });

  const formattedNew = newProducts.map(p => ({
    _id: p._id,
    brandId: p.brandId,
    products: p.products,
    BrandNameStr: brandMap[p.brandId] || 'Unknown'
  }));

  // Old data
  const oldProducts = await OldProduct.find();
  const oldBrands = await OldBrand.find();
  const oldBrandMap = {};
  oldBrands.forEach(b => {
    oldBrandMap[b.proId] = b.brands;
  });

  const formattedOld = oldProducts.map(p => ({
    _id: p._id,
    brandId: p._id.toString(), // Treat product ID as brand link
    products: p.name,
    BrandNameStr: oldBrandMap[p._id.toString()] || 'Unknown'
  }));

  return [...formattedNew, ...formattedOld];
};

module.exports = {
  getAllUnifiedProducts
};
