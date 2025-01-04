const mongoose = require('mongoose');
const Product = require('../models/Product');
const Brand = require('../models/Brand');
const Transaction = require("../models/Transaction");

// Create a new brand and associate it with a product
const createBrand = async (req, res) => {
  const { proId, brands } = req.body;

  try {
    if (!mongoose.Types.ObjectId.isValid(proId)) {
      return res.status(400).json({ error: 'Invalid Product ID' });
    }

    const product = await Product.findById(proId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const existingBrand = await Brand.findOne({ proId, brands });
    if (existingBrand) {
      return res.status(400).json({ error: 'Brand already exists for this product' });
    }

    const newBrand = new Brand({ proId, brands });
    await newBrand.save();

    res.status(201).json(newBrand);
  } catch (error) {
    console.error('Error creating brand:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all brands for a specific product by proId
const getBrandsByProductId = async (req, res) => {
  const { proId } = req.params;

  try {
    const brands = await Brand.find({ proId });
    if (brands.length === 0) {
      return res.status(404).json({ error: 'No brands found for this product' });
    }
    res.status(200).json(brands);
  } catch (error) {
    console.error('Error fetching brands:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getAllBrands = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  try {
    let querySet = [
      { $match: { } },
      {
        $addFields: {
          productId: {
            $cond: {
              if: { $regexMatch: { input: "$proId", regex: /^[0-9a-fA-F]{24}$/ } }, then: { $toObjectId: "$proId" }, else: null
            }
          }
        }
      },
      {
        $lookup: {from: 'products', localField: 'productId', foreignField: '_id', as: 'productsData'}
      },
      { $unwind: { path: '$productsData', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          proId: 1,
          ProductNameStr: { $ifNull: ['$productsData.name', ''] },
          brands: 1,
        }
      },
      { $skip: ((page - 1) * limit) },
      { $limit: limit },
    ];
    const brands = await Brand.aggregate(querySet)

    // const brands = await Brand.find().skip(skip).limit(limit);
    const totalBrands = await Brand.countDocuments();
    const totalPages = Math.ceil(totalBrands / limit);

    res.json({
      brands,
      pagination: {
        currentPage: page,
        totalPages,
        totalBrands,
      },
    });
  } catch (error) {
    res.status(400).json({ error: 'Error fetching brands' });
  }
};

const updateBrand = async (req, res) => {
  const { id } = req.params;
  const { proId, brands } = req.body;

  try {
    // Check if the brand exists
    const brand = await Brand.findById(id);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    // Check if the product ID is valid
    if (!mongoose.Types.ObjectId.isValid(proId)) {
      return res.status(400).json({ error: 'Invalid Product ID' });
    }

    // Check if the product exists
    const product = await Product.findById(proId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Check for duplicate brand-product combination (exclude the current brand from the check)
    const existingBrand = await Brand.findOne({ proId, brands });
    if (existingBrand && existingBrand._id.toString() !== brand._id.toString()) {
      return res.status(400).json({ error: 'This product and brand combination already exists.' });
    }

    // If data is the same, allow saving without error
    if (brand.proId.toString() === proId && brand.brands === brands) {
      return res.status(200).json(brand);  // No changes, so return the brand as it is.
    }

    // Update the brand with new data
    brand.proId = proId || brand.proId;
    brand.brands = brands || brand.brands;

    // Save the updated brand
    await brand.save();

    res.status(200).json(brand);
  } catch (error) {
    console.error('Error updating brand:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete a brand by its ID
const deleteBrand = async (req, res) => {
  const { id } = req.params;
  try {
    const brand = await Brand.findByIdAndDelete(id);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    return res.status(200).json({ message: 'Brand deleted successfully' });
  } catch (error) {
    console.error('Error deleting brand:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getAllBrandsForSelect = async (req, res) => {
  try {
    const products = await Brand.find({proId: req.params.brandId});
    res.status(200).json(products);
  } catch (error) {
    res.status(400).json({ error: 'Error fetching products' });
  }
};

const getBrandsByBrandName = async (req, res) => {
  const { brandName } = req.params;
  const page = parseInt(req.query.page || 1);
  const limit = parseInt(req.query.limit || 10);

  try {
    const querySet = [
      { $match: { brands: { $regex: brandName, $options: 'i' } } },
      {
        $addFields: {
          productId: {
            $cond: {
              if: { $regexMatch: { input: "$proId", regex: /^[0-9a-fA-F]{24}$/ } },
              then: { $toObjectId: "$proId" },
              else: null
            }
          }
        }
      },
      { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'productData' } },
      { $unwind: { path: '$productData', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, proId: 1, brands: 1, ProductNameStr: { $ifNull: ['$productData.name', ''] } } }
    ];

    const [brands, totalBrands] = await Promise.all([
      Brand.aggregate(querySet).skip((page - 1) * limit).limit(limit),
      Brand.countDocuments({ brands: { $regex: brandName, $options: 'i' } })
    ]);

    if (!brands.length) return res.status(404).json({ error: 'No brands found matching that name' });

    res.status(200).json({
      status: 200,
      data: brands,
      total: totalBrands,
      pages: Math.ceil(totalBrands / limit),
      currentPage: page
    });

  } catch (error) {
    console.error('Error fetching brands by name:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


module.exports = { createBrand, getBrandsByProductId, getAllBrands, updateBrand, deleteBrand, getAllBrandsForSelect,getBrandsByBrandName };
