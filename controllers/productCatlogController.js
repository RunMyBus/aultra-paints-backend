const productOfferModel = require('../models/productOffers.model');
const AWS = require('aws-sdk');
const s3 = require("../config/aws");
const multer = require('multer');
const { decodeBase64Image } = require('../services/utils.service');
const ProductPriceModel = require('../models/ProductPrice');
const UserModel = require('../models/User');
const logger = require('../utils/logger');


// Create Product Catlog
exports.createProductCatlog = async (req, res) => {
  console.log('req body ---- ', req.body);
  let { productDescription, productStatus, price, focusProductId, focusUnitId = 1 } = req.body;

  let imageData = null;
  if (req.body.productImage) {
    // Decode the base64 image
    imageData = await decodeBase64Image(req.body.productImage);
    if (imageData instanceof Error) {
      return res.status(400).json({ message: 'Invalid image data' });
    }
  }

  // Parse and validate price field
  let parsedPrice = [];
  try {
    const priceData = typeof price === 'string' ? JSON.parse(price) : price;
    if (typeof priceData !== 'object' || priceData === null) {
      throw new Error('Price data must be an object');
    }

    // Transform the price data to match the schema
    for (const [volume, priceEntries] of Object.entries(priceData)) {
      if (!Array.isArray(priceEntries)) continue;

      priceEntries.forEach(entry => {
        const [[refId, priceValue]] = Object.entries(entry);
        if (refId && priceValue !== undefined) {
          parsedPrice.push({
            volume,
            refId,
            price: Number(priceValue)
          });
        }
      });
    }

    if (parsedPrice.length === 0) {
      throw new Error('No valid price entries found');
    }
  } catch (error) {
    console.error('Error parsing price data:', error);
    return res.status(400).json({ message: 'Invalid price format: ' + error.message });
  }

  // Create the product catlog document
  const productCatlog = new productOfferModel({
    productOfferDescription: productDescription,
    productOfferStatus: productStatus,
    price: parsedPrice,
    offerAvailable: false,
    focusProductId: focusProductId ? Number(focusProductId) : null,
    focusUnitId: focusUnitId ? Number(focusUnitId) : null
  });

  try {
    const existingProductCatlog = await productOfferModel.findOne({ productOfferDescription: productDescription });
    if (existingProductCatlog) {
      return res.status(400).json({ message: 'Product catlog with the same description already exists' });
    }

    // Save the product catlog
    let savedProductCatlog = await productCatlog.save();
    const savedProductCatlogId = savedProductCatlog._id;

    // Upload the image to AWS S3 if image data exists
    if (imageData) {
      const params = {
        Bucket: process.env.AWS_BUCKET_PRODUCT_CATEGORY,
        Key: `${savedProductCatlogId}.png`,
        Body: imageData.data,
        ContentType: imageData.type,
        ACL: 'public-read',
      };

      const data = await s3.upload(params).promise();
      await productOfferModel.updateOne(
        { _id: savedProductCatlog._id },
        { $set: { productOfferImageUrl: data.Location } }
      );
      savedProductCatlog.productOfferImageUrl = data.Location;
    }

    await processProductCatlogPrices(savedProductCatlogId, parsedPrice);

    return res.status(201).json(savedProductCatlog);
  } catch (error) {
    console.log(error);
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds the limit (4 MB)' });
      }
    } else {
      return res.status(500).json({ message: error.message });
    }
  }
};


const processProductCatlogPrices = async (productcatlogId, parsedPrices) => {
  try {
    // Remove existing prices for the product
    await ProductPriceModel.deleteMany({ productOfferId: productcatlogId });

    // Group prices by refId for easier lookup
    const pricesByRefId = {};
    parsedPrices.forEach(item => {
      if (!pricesByRefId[item.refId]) {
        pricesByRefId[item.refId] = [];
      }
      pricesByRefId[item.refId].push({
        volume: item.volume,
        price: item.price
      });
    });

    // Fetch all dealers
    const dealers = await UserModel.find({ accountType: 'Dealer' });
    const productPrices = [];

    // For each dealer, find matching prices based on district/zone/state/All
    for (const dealer of dealers) {
      // Find the best matching refId for this dealer
      const refId = [
        dealer.district,
        dealer.zone,
        dealer.state,
        'All'
      ].find(id => id && pricesByRefId[id]);

      if (refId) {
        // For each volume price for this refId, create a price entry
        for (const priceInfo of pricesByRefId[refId]) {
          productPrices.push({
            productOfferId: productcatlogId,
            dealerId: dealer._id,
            price: priceInfo.price,
            volume: priceInfo.volume
          });
        }
      }
    }

    if (productPrices.length > 0) {
      await ProductPriceModel.insertMany(productPrices);
    }

    logger.info("Product catalog prices updated successfully.");
  } catch (error) {
    console.error('Error while processing product catalog prices --- ', error);
    logger.error('Error while processing product catalog prices', {
      error: error.message,
      errorObj: JSON.stringify(error)
    });
  }
};

exports.getProductCatlogs = async (req, res) => {
  try {
    let page = req.body.page || 1;
    let limit = req.body.limit || 10;

    const productCatlogs = await productOfferModel.find({ productOfferStatus: 'Active' })
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    res.status(200).json(productCatlogs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.searchProductCatlog = async (req, res) => {
  try {
    const page = parseInt(req.body.page || 1);
    const limit = parseInt(req.body.limit || 10);
    const dealerId = req.user._id.toString();
    const accountType = req.user.accountType;
    let query = {};

    query['offerAvailable'] = false;

    // Search by productDescription 
    if (req.body.searchQuery) {
      query['productOfferDescription'] = {
        $regex: new RegExp(req.body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      };
    }

    const data = await productOfferModel
      .find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await productOfferModel.countDocuments(query);

    let updatedData = await Promise.all(data.map(async (productCatlog) => {
      let prices = [];
      const priceArray = []; // Array to store {volume, price} objects

      if (accountType === 'SuperUser') {
        // For SuperUser, use the prices directly from the product catalog
        prices = productCatlog.price || [];

        // Track which volumes we've already processed
        const processedVolumes = new Set();

        // First pass: Add dealer-specific prices
        prices.forEach(priceObj => {
          if (priceObj.volume && priceObj.refId === dealerId) {
            priceArray.push({
              volume: priceObj.volume,
              price: priceObj.price
            });
            processedVolumes.add(priceObj.volume);
          }
        });

        // Second pass: Add 'All' prices for volumes not already processed
        prices.forEach(priceObj => {
          if (priceObj.volume && priceObj.refId === 'All' && !processedVolumes.has(priceObj.volume)) {
            priceArray.push({
              volume: priceObj.volume,
              price: priceObj.price
            });
          }
        });
      } else {
        // For dealers, get their specific prices
        const dealerPrices = await ProductPriceModel.find({
          productOfferId: productCatlog._id,
          dealerId: dealerId
        });

        // If no dealer-specific prices found, fall back to 'All' prices
        if (dealerPrices.length === 0) {
          const allPrices = await ProductPriceModel.find({
            productOfferId: productCatlog._id,
            refId: 'All'
          });
          prices = allPrices;
        } else {
          prices = dealerPrices;
        }

        // Create the price array
        prices.forEach(price => {
          if (price.volume) {
            priceArray.push({
              volume: price.volume,
              price: price.price
            });
          }
        });
      }

      return {
        ...productCatlog._doc,
        productPrices: priceArray,
        productPrice: priceArray[0]?.price || 0
      };
    }));

    return res.status(200).json({
      data: updatedData,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (err) {
    console.error("Error in searchProductCatlog:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};


exports.updateProductCatlog = async (req, res) => {
  console.log('req.body:', req.body);
  try {
      const { price, focusProductId, focusUnitId } = req.body;
    const existingProductCatlog = await productOfferModel.findOne({
      productOfferDescription: req.body.productDescription,
      _id: { $ne: req.params.id }
    });
    if (existingProductCatlog) {
      return res.status(400).json({ message: 'Product catlog with the same description already exists.' });
    }

    // Check if an image is being uploaded
    if (req.body.productImage) {
      if (req.body.productImageUrl) {
        let imgUrlSplit = req.body.productImageUrl.split('/').pop();
        const paramsRemove = {
          Bucket: process.env.AWS_BUCKET_PRODUCT_CATEGORY,
          Key: imgUrlSplit,
        };
        await s3.deleteObject(paramsRemove).promise();
      }

      // Decode the base64 image and upload it to S3
      const imageData = await decodeBase64Image(req.body.productImage);
      const params = {
        Bucket: process.env.AWS_BUCKET_PRODUCT_CATEGORY,
        Key: `${req.params.id}.png`,
        Body: imageData.data,
        ContentType: imageData.type,
        ACL: 'public-read'
      };

      const data = await s3.upload(params).promise();
      req.body.productImageUrl = data.Location;
    }

    // Parse and validate price field
    let parsedPrice = [];
    try {
      const priceData = typeof price === 'string' ? JSON.parse(price) : price;

      if (typeof priceData !== 'object' || priceData === null) {
        throw new Error('Price data must be an object');
      }

      // Transform the price data to match the schema
      for (const [volume, priceEntries] of Object.entries(priceData)) {
        if (!Array.isArray(priceEntries)) continue;

        priceEntries.forEach(entry => {
          const [[refId, priceValue]] = Object.entries(entry);
          if (refId && priceValue !== undefined) {
            parsedPrice.push({
              volume,
              refId,
              price: Number(priceValue)
            });
          }
        });
      }

      if (parsedPrice.length === 0) {
        throw new Error('No valid price entries found');
      }
    } catch (error) {
      console.error('Error parsing price data:', error);
      return res.status(400).json({ message: 'Invalid price format: ' + error.message });
    }

    // Prepare update data
    const updateData = {
      productOfferDescription: req.body.productDescription,
      productOfferStatus: req.body.productStatus,
      price: parsedPrice,
      updatedBy: req.body.updatedBy,
      focusProductId: focusProductId ? Number(focusProductId) : null,
      focusUnitId: focusUnitId ? Number(focusUnitId) : null
    };

    // Add image URL if it was updated
    if (req.body.productImageUrl) {
      updateData.productOfferImageUrl = req.body.productImageUrl;
    }

    // Update the product catalog
    const productCatlog = await productOfferModel.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!productCatlog) {
      return res.status(404).json({ message: 'Product catalog not found' });
    }

    // Update the product prices
    await processProductCatlogPrices(req.params.id, parsedPrice);

    return res.status(200).json({ data: productCatlog });
  } catch (error) {
    console.log(error);
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds 4 MB!' });
      }
    } else {
      return res.status(500).json({ message: error.message });
    }
  }
};

// Delete Product Catlog
exports.deleteProductCatlog = async (req, res) => {
  try {
    const productCatlog = await productOfferModel.findByIdAndDelete(req.params.id);
    if (!productCatlog) {
      return res.status(404).json({ message: 'Product catlog not found' });
    }
    res.status(200).json({ message: 'Product catlog deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
