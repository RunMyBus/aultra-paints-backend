const mongoose = require('mongoose');
const Product = require('../models/Product');
const Brand = require('../models/Brand'); // assuming Brand still exists and is referenced
const Transaction = require("../models/Transaction");
const { getAllUnifiedProducts } = require('../services/productService');

// Create a new product and associate it with a brand
const createProduct = async (req, res) => {
  const { brandId, products } = req.body;

  try {
    if (!mongoose.Types.ObjectId.isValid(brandId)) {
      return res.status(400).json({ error: 'Invalid Brand ID' });
    }

    const objectBrandId = new mongoose.Types.ObjectId(brandId);

    const brand = await Brand.findById(objectBrandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const existingProduct = await Product.findOne({ brandId: objectBrandId, products });
    if (existingProduct) {
      return res.status(400).json({ error: 'Product already exists for this brand' });
    }

    const newProduct = new Product({ brandId: objectBrandId, products });
    await newProduct.save();

    res.status(201).json(newProduct);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all products for a specific brand by brandId
const getProductsByBrandId = async (req, res) => {
  const { brandId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    return res.status(400).json({ error: 'Invalid brand ID' });
  }

  try {
    const products = await Product.find({ brandId });

    if (!products.length) {
      return res.status(404).json({ error: 'No products found for this brand ID' });
    }

    return res.status(200).json({ products });
  } catch (error) {
    console.error('Error fetching products by brandId:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all products with pagination and joined brand data
const getAllProducts = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;

  try {
    const pipeline = [
      {
        $addFields: {
          brandObjId: {
            $cond: {
              if: {
                $and: [
                  { $ne: ["$brandId", null] },
                  { $ne: [{ $type: "$brandId" }, "objectId"] }
                ]
              },
              then: { $toObjectId: "$brandId" },
              else: "$brandId"
            }
          }
        }
      },
      {
        $lookup: {
          from: 'brands',
          localField: 'brandObjId',
          foreignField: '_id',
          as: 'brandData'
        }
      },
      { $unwind: { path: '$brandData', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          brandId: 1,
          BrandNameStr: { $ifNull: ['$brandData.name', ''] },
          products: 1
        }
      },
      { $sort: { _id: -1 } }, // Optional: Sort by latest first
      { $skip: (page - 1) * limit },
      { $limit: limit }
    ];

    const products = await Product.aggregate(pipeline);
    const total = await Product.countDocuments();

    res.json({
      products,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalProducts: total
      }
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


const updateProduct = async (req, res) => {
  const { id } = req.params;
  const { brandId, products } = req.body;

  try {
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (!mongoose.Types.ObjectId.isValid(brandId)) {
      return res.status(400).json({ error: 'Invalid Brand ID' });
    }

    const brand = await Brand.findById(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const existingProduct = await Product.findOne({ brandId, products });
    if (existingProduct && existingProduct._id.toString() !== product._id.toString()) {
      return res.status(400).json({ error: 'This brand and product combination already exists.' });
    }

    if (product.brandId === brandId && product.products === products) {
      return res.status(200).json(product);
    }

    product.brandId = brandId;
    product.products = products;
    await product.save();

    res.status(200).json(product);
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteProduct = async (req, res) => {
  const { id } = req.params;
  try {
    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    return res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getAllProductsForSelect = async (req, res) => {
  try {
    const products = await Product.find({ brandId: req.params.brandId });
    res.status(200).json(products);
  } catch (error) {
    res.status(400).json({ error: 'Error fetching products for select' });
  }
};

const getProductsByName = async (req, res) => {
  const { productName } = req.params;
  const page = parseInt(req.query.page || 1);
  const limit = parseInt(req.query.limit || 10);

  try {
    const pipeline = [
      { $match: { products: { $regex: productName, $options: 'i' } } },
      {
        $addFields: {
          brandObjId: {
            $cond: {
              if: { $regexMatch: { input: "$brandId", regex: /^[0-9a-fA-F]{24}$/ } },
              then: { $toObjectId: "$brandId" },
              else: null
            }
          }
        }
      },
      {
        $lookup: {
          from: 'brands',
          localField: 'brandObjId',
          foreignField: '_id',
          as: 'brandData'
        }
      },
      { $unwind: { path: '$brandData', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          brandId: 1,
          products: 1,
          BrandNameStr: { $ifNull: ['$brandData.name', ''] }
        }
      }
    ];

    const [products, totalProducts] = await Promise.all([
      Product.aggregate(pipeline).skip((page - 1) * limit).limit(limit),
      Product.countDocuments({ products: { $regex: productName, $options: 'i' } })
    ]);

    if (!products.length) {
      return res.status(404).json({ error: 'No products found matching that name' });
    }

    res.status(200).json({
      status: 200,
      data: products,
      total: totalProducts,
      pages: Math.ceil(totalProducts / limit),
      currentPage: page
    });

  } catch (error) {
    console.error('Error fetching products by name:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getUnifiedProductList = async (req, res) => {
  try {
    const products = await getAllUnifiedProducts();
    res.status(200).json({
      products,
      pagination: {
        totalProducts: products.length
      }
    });
  } catch (err) {
    console.error('Error fetching unified product list:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createProduct,
  getProductsByBrandId,
  getAllProducts,
  updateProduct,
  deleteProduct,
  getAllProductsForSelect,
  getProductsByName,
  getUnifiedProductList
};
