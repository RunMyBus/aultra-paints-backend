const productOfferModel = require('../models/productOffers.model');
const AWS = require('aws-sdk');
const s3 = require("../config/aws");
const multer = require('multer');
const { decodeBase64Image } = require('../services/utils.service');
const ProductPriceModel = require('../models/ProductPrice');
const UserModel = require('../models/User');
const logger = require('../utils/logger');
const { getPriceBookData, getDealerAccountId } = require('../services/focus8Order.service');

// ── Focus8 in-memory cache (10 min TTL) ───────────────────────────────────
const _f8Cache = {
  priceBook: { data: null, ts: 0 },
  dealerAccounts: new Map(),
};
const F8_TTL = 10 * 60 * 1000;

async function _cachedPriceBook() {
  if (_f8Cache.priceBook.data && Date.now() - _f8Cache.priceBook.ts < F8_TTL) {
    return _f8Cache.priceBook.data;
  }
  const data = await getPriceBookData();
  _f8Cache.priceBook = { data, ts: Date.now() };
  return data;
}

async function _cachedDealerAccountId(dealerCode) {
  const cached = _f8Cache.dealerAccounts.get(dealerCode);
  if (cached && Date.now() - cached.ts < F8_TTL) return cached.id;
  const id = await getDealerAccountId(dealerCode);
  _f8Cache.dealerAccounts.set(dealerCode, { id, ts: Date.now() });
  return id;
}
// ─────────────────────────────────────────────────────────────────────────

// Create Product Catlog
exports.createProductCatlog = async (req, res) => {
  let { productDescription, productStatus, price, focusProductId, focusUnitId = 1, focusProductMapping, productCategory } = req.body;

  if (!req.body.productImage) {
    return res.status(400).json({ message: 'Product  image is required' });
  }

  // Decode the base64 image
  const imageData = await decodeBase64Image(req.body.productImage);
  if (imageData instanceof Error) {
    return res.status(400).json({ message: 'Invalid image data' });
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

  // Parse and validate focusProductMapping if provided
  let parsedFocusMapping = null;
  if (focusProductMapping) {
    try {
      const mappingData = typeof focusProductMapping === 'string' 
        ? JSON.parse(focusProductMapping) 
        : focusProductMapping;

      if (!Array.isArray(mappingData)) {
        throw new Error('focusProductMapping must be an array');
      }

      // Validate mapping structure
      parsedFocusMapping = mappingData.map(mapping => {
        if (!mapping.volume || !mapping.focusProductId) {
          throw new Error('Each mapping must have volume and focusProductId');
        }
        return {
          volume: mapping.volume,
          focusProductId: Number(mapping.focusProductId),
          focusUnitId: mapping.focusUnitId ? Number(mapping.focusUnitId) : 1
        };
      });

      // Validate that all volumes in price have corresponding mapping
      const priceVolumes = [...new Set(parsedPrice.map(p => p.volume))];
      const mappingVolumes = parsedFocusMapping.map(m => m.volume);
      const missingVolumes = priceVolumes.filter(v => !mappingVolumes.includes(v));
      
      if (missingVolumes.length > 0) {
        throw new Error(`Missing focus product mapping for volumes: ${missingVolumes.join(', ')}`);
      }

      // Check for duplicate volumes in mapping
      const volumeCounts = {};
      mappingVolumes.forEach(v => {
        volumeCounts[v] = (volumeCounts[v] || 0) + 1;
      });
      const duplicates = Object.keys(volumeCounts).filter(v => volumeCounts[v] > 1);
      if (duplicates.length > 0) {
        throw new Error(`Duplicate volumes in focus product mapping: ${duplicates.join(', ')}`);
      }

    } catch (error) {
      console.error('Error parsing focus product mapping:', error);
      return res.status(400).json({ message: 'Invalid focus product mapping: ' + error.message });
    }
  }

  // Create the product catlog document
  const productCatlog = new productOfferModel({
    productOfferDescription: productDescription,
    productOfferStatus: productStatus,
    price: parsedPrice,
    offerAvailable: false,
    productCategory: productCategory || null,
    focusProductId: focusProductId ? Number(focusProductId) : null,
    focusUnitId: focusUnitId ? Number(focusUnitId) : null,
    focusProductMapping: parsedFocusMapping || undefined
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


/**
 * Helper function to parse Focus8 date string
 * @param {string|number} dateStr - Date string in DD-MM-YYYY format or timestamp
 * @returns {number} Days since epoch
 */
const parseFocusDate = (dateStr) => {
  if (!dateStr) return 0;
  
  if (typeof dateStr === 'string' && dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`);
      return Math.floor(date.getTime() / (1000 * 60 * 60 * 24));
    }
  }
  
  if (!isNaN(dateStr)) return Number(dateStr);
  return 0;
};

/**
 * Helper function to get the effective price from Focus8 pricebook
 * @param {number} focusProductId - The Focus8 product ID
 * @param {number} focusAccountId - The Focus8 account ID (iMasterId)
 * @param {Array} priceBookRecords - All pricebook records from Focus8
 * @param {number} catalogPrice - Fallback price from product catalog
 * @returns {number} The effective price
 */
const getEffectivePriceFromFocus = (focusProductId, focusAccountId, priceBookRecords, catalogPrice) => {
  if (!focusProductId || !focusAccountId || !priceBookRecords || priceBookRecords.length === 0) {
    return catalogPrice;
  }

  const currentDate = Math.floor(Date.now() / 1000 / 60 / 60 / 24); // Days since epoch

  // Filter records matching product and account
  const matchingRecords = priceBookRecords.filter(record => 
    Number(record.iProductId) === Number(focusProductId) && 
    Number(record.iAccountId) === Number(focusAccountId) &&
    parseFocusDate(record.iStartDate) <= currentDate // Only prices that are already effective
  );

  if (matchingRecords.length === 0) {
    return catalogPrice;
  }

  // Sort by iStartDate descending (latest first)
  matchingRecords.sort((a, b) => parseFocusDate(b.iStartDate) - parseFocusDate(a.iStartDate));

  // Return the latest price (fVal1)
  const effectivePrice = Number(matchingRecords[0].fVal1);
  
  logger.info(`FOCUS8 :: Found custom price for product ${focusProductId}, account ${focusAccountId}: ${effectivePrice}`);
  
  return effectivePrice || catalogPrice;
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
    const accountType = req.user.accountType;
    let query = {};

    query['offerAvailable'] = false;

    if (req.body.searchQuery) {
      query['$or'] = [
        { 'productOfferDescription': { $regex: new RegExp(req.body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } },
      ];
    }

    // SuperUser sees all catalog items regardless of product category.
    // Dealers see only items whose productCategory matches one of their assigned categories.
    // SalesExecutives see only items that have a productCategory set.
    if (req.user.accountType === 'Dealer') {
      const dealerCategories = req.user.productCategories || [];
      const categoryFilter = { productCategory: { $in: dealerCategories } };
      if (query['$or']) {
        query['$and'] = [{ $or: query['$or'] }, categoryFilter];
        delete query['$or'];
      } else {
        Object.assign(query, categoryFilter);
      }
    } else if (req.user.accountType === 'SalesExecutive') {
      const seCategoryFilter = { productCategory: { $ne: null, $exists: true } };
      if (query['$or']) {
        query['$and'] = [{ $or: query['$or'] }, seCategoryFilter];
        delete query['$or'];
      } else {
        Object.assign(query, seCategoryFilter);
      }
    }

    // ── Run find + count in parallel ─────────────────────────────────────
    const [data, total] = await Promise.all([
      productOfferModel.find(query).skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 }),
      productOfferModel.countDocuments(query),
    ]);

    let targetDealerId = req.body.dealerId || req.user._id.toString();
    const needsDealerPrices = accountType === 'Dealer' || (accountType === 'SalesExecutive' && req.body.dealerId);

    // ── Dealer info + Focus8 (cached) ────────────────────────────────────
    let dealerCode = null;
    let priceBookRecords = [];
    let focusAccountId = null;

    if (needsDealerPrices) {
      try {
        const dealerUser = await UserModel.findById(targetDealerId).select('dealerCode');
        dealerCode = dealerUser?.dealerCode || null;
      } catch (err) {
        logger.error('Error fetching dealer details', { targetDealerId, error: err.message });
      }
    }

    if (dealerCode) {
      try {
        [focusAccountId, priceBookRecords] = await Promise.all([
          _cachedDealerAccountId(dealerCode),
          _cachedPriceBook(),
        ]);
        logger.info(`FOCUS8 :: Dealer ${dealerCode} account ID: ${focusAccountId}, ${priceBookRecords.length} pricebook records (cached)`);
      } catch (err) {
        logger.error('FOCUS8 :: Error fetching pricebook data', { dealerCode, error: err.message });
      }
    }

    // ── Batch price queries (replaces N+1 loop) ──────────────────────────
    const allProductIds = data.map(p => p._id.toString());
    let dealerPriceMap = {};   // productOfferId → [price docs]
    let fallbackPriceMap = {}; // productOfferId → [price docs]

    if (needsDealerPrices && allProductIds.length > 0) {
      const dealerPrices = await ProductPriceModel.find({
        productOfferId: { $in: allProductIds },
        dealerId: targetDealerId,
      });
      dealerPrices.forEach(p => {
        (dealerPriceMap[p.productOfferId] = dealerPriceMap[p.productOfferId] || []).push(p);
      });

      const needsFallback = allProductIds.filter(id => !dealerPriceMap[id]?.length);
      if (needsFallback.length > 0) {
        const fallbackPrices = await ProductPriceModel.find({
          productOfferId: { $in: needsFallback },
        });
        fallbackPrices.forEach(p => {
          (fallbackPriceMap[p.productOfferId] = fallbackPriceMap[p.productOfferId] || []).push(p);
        });
      }
    }

    // ── Map products (synchronous — no per-product DB calls) ─────────────
    const updatedData = data.map(productCatlog => {
      const priceArray = [];
      let prices = [];

      if (accountType === 'SuperUser') {
        prices = productCatlog.price || [];
        const processedVolumes = new Set();
        prices.forEach(priceObj => {
          if (priceObj.volume && priceObj.refId === targetDealerId) {
            priceArray.push({ volume: priceObj.volume, price: priceObj.price });
            processedVolumes.add(priceObj.volume);
          }
        });
        prices.forEach(priceObj => {
          if (priceObj.volume && priceObj.refId === 'All' && !processedVolumes.has(priceObj.volume)) {
            priceArray.push({ volume: priceObj.volume, price: priceObj.price });
          }
        });
      } else if (accountType === 'SalesExecutive' && !req.body.dealerId) {
        prices = productCatlog.price || [];
        prices.forEach(priceObj => {
          if (priceObj.volume && priceObj.refId === 'All') {
            priceArray.push({ volume: priceObj.volume, price: priceObj.price });
          }
        });
      } else {
        const id = productCatlog._id.toString();
        prices = dealerPriceMap[id]?.length ? dealerPriceMap[id] : (fallbackPriceMap[id] || []);

        prices.forEach(price => {
          if (!price.volume) return;
          let finalPrice = price.price;
          let volumeFocusProductId = null;

          if (productCatlog.focusProductMapping?.length > 0) {
            const mapping = productCatlog.focusProductMapping.find(m => m.volume === price.volume);
            if (mapping?.focusProductId) volumeFocusProductId = mapping.focusProductId;
          } else if (productCatlog.focusProductId) {
            volumeFocusProductId = productCatlog.focusProductId;
          }

          if (focusAccountId && volumeFocusProductId && priceBookRecords.length > 0) {
            finalPrice = getEffectivePriceFromFocus(volumeFocusProductId, focusAccountId, priceBookRecords, price.price);
          }

          priceArray.push({
            volume: price.volume,
            price: finalPrice,
            focusProductId: volumeFocusProductId,
            source: finalPrice !== price.price ? 'focus8' : 'catalog',
          });
        });
      }

      return {
        ...productCatlog._doc,
        productPrices: priceArray,
        productPrice: priceArray[0]?.price || 0,
      };
    });

    return res.status(200).json({
      data: updatedData,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
    });
  } catch (err) {
    console.error("Error in searchProductCatlog:", err);
    logger.error("Error in searchProductCatlog", { error: err.message, stack: err.stack });
    return res.status(500).json({ message: "Something went wrong" });
  }
};


exports.updateProductCatlog = async (req, res) => {
  console.log('req.body:', req.body);
  try {
    const { price, focusProductId, focusUnitId, focusProductMapping, productCategory } = req.body;
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

    // Parse and validate focusProductMapping if provided
    let parsedFocusMapping = null;
    if (focusProductMapping) {
      try {
        const mappingData = typeof focusProductMapping === 'string' 
          ? JSON.parse(focusProductMapping) 
          : focusProductMapping;

        if (!Array.isArray(mappingData)) {
          throw new Error('focusProductMapping must be an array');
        }

        // Validate mapping structure
        parsedFocusMapping = mappingData.map(mapping => {
          if (!mapping.volume || !mapping.focusProductId) {
            throw new Error('Each mapping must have volume and focusProductId');
          }
          return {
            volume: mapping.volume,
            focusProductId: Number(mapping.focusProductId),
            focusUnitId: mapping.focusUnitId ? Number(mapping.focusUnitId) : 1
          };
        });

        // Validate that all volumes in price have corresponding mapping
        const priceVolumes = [...new Set(parsedPrice.map(p => p.volume))];
        const mappingVolumes = parsedFocusMapping.map(m => m.volume);
        const missingVolumes = priceVolumes.filter(v => !mappingVolumes.includes(v));
        
        if (missingVolumes.length > 0) {
          throw new Error(`Missing focus product mapping for volumes: ${missingVolumes.join(', ')}`);
        }

        // Check for duplicate volumes in mapping
        const volumeCounts = {};
        mappingVolumes.forEach(v => {
          volumeCounts[v] = (volumeCounts[v] || 0) + 1;
        });
        const duplicates = Object.keys(volumeCounts).filter(v => volumeCounts[v] > 1);
        if (duplicates.length > 0) {
          throw new Error(`Duplicate volumes in focus product mapping: ${duplicates.join(', ')}`);
        }
      } catch (error) {
        console.error('Error parsing focus product mapping:', error);
        return res.status(400).json({ message: 'Invalid focus product mapping: ' + error.message });
      }
    }

    // Prepare update data
    const updateData = {
      productOfferDescription: req.body.productDescription,
      productOfferStatus: req.body.productStatus,
      price: parsedPrice,
      updatedBy: req.body.updatedBy,
      productCategory: productCategory || null,
      focusProductId: focusProductId ? Number(focusProductId) : null,
      focusUnitId: focusUnitId ? Number(focusUnitId) : null
    };

    // Add focusProductMapping if provided
    if (parsedFocusMapping !== null) {
      updateData.focusProductMapping = parsedFocusMapping;
    }

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
