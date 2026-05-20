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
  let { productDescription, productStatus, focusProductId, focusUnitId = 1, focusProductMapping, productCategory } = req.body;

  if (!req.body.productImage) {
    return res.status(400).json({ message: 'Product image is required' });
  }

  const imageData = await decodeBase64Image(req.body.productImage);
  if (imageData instanceof Error) {
    return res.status(400).json({ message: 'Invalid image data' });
  }

  // focusProductMapping is required — prices are seeded from Focus8, not entered manually
  if (!focusProductMapping) {
    return res.status(400).json({ message: 'focusProductMapping is required' });
  }

  let parsedFocusMapping;
  try {
    const mappingData = typeof focusProductMapping === 'string'
      ? JSON.parse(focusProductMapping)
      : focusProductMapping;

    if (!Array.isArray(mappingData) || mappingData.length === 0) {
      throw new Error('focusProductMapping must be a non-empty array');
    }

    parsedFocusMapping = mappingData.map(m => {
      if (!m.volume || !m.focusProductId) {
        throw new Error('Each mapping must have volume and focusProductId');
      }
      return {
        volume: m.volume,
        focusProductId: Number(m.focusProductId),
        focusUnitId: m.focusUnitId ? Number(m.focusUnitId) : 1,
      };
    });

    const volumeCounts = {};
    parsedFocusMapping.forEach(m => { volumeCounts[m.volume] = (volumeCounts[m.volume] || 0) + 1; });
    const duplicates = Object.keys(volumeCounts).filter(v => volumeCounts[v] > 1);
    if (duplicates.length > 0) {
      throw new Error(`Duplicate volumes in mapping: ${duplicates.join(', ')}`);
    }
  } catch (error) {
    return res.status(400).json({ message: 'Invalid focusProductMapping: ' + error.message });
  }

  let savedProductCatlog;
  try {
    const existing = await productOfferModel.findOne({ productOfferDescription: productDescription });
    if (existing) {
      return res.status(400).json({ message: 'Product catalog with the same description already exists' });
    }

    savedProductCatlog = await new productOfferModel({
      productOfferDescription: productDescription,
      productOfferStatus: productStatus,
      price: [],
      offerAvailable: false,
      productCategory: productCategory || null,
      focusProductId: focusProductId ? Number(focusProductId) : null,
      focusUnitId: focusUnitId ? Number(focusUnitId) : null,
      focusProductMapping: parsedFocusMapping,
    }).save();

    if (imageData) {
      const s3Data = await s3.upload({
        Bucket: process.env.AWS_BUCKET_PRODUCT_CATEGORY,
        Key: `${savedProductCatlog._id}.png`,
        Body: imageData.data,
        ContentType: imageData.type,
        ACL: 'public-read',
      }).promise();
      await productOfferModel.updateOne(
        { _id: savedProductCatlog._id },
        { $set: { productOfferImageUrl: s3Data.Location } }
      );
      savedProductCatlog.productOfferImageUrl = s3Data.Location;
    }

    await seedPricesFromFocus(savedProductCatlog);

    return res.status(201).json(savedProductCatlog);
  } catch (error) {
    // Roll back the saved document if price seeding failed
    if (savedProductCatlog?._id) {
      await productOfferModel.findByIdAndDelete(savedProductCatlog._id).catch(() => {});
    }
    console.log(error);
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds the limit (4 MB)' });
    }
    return res.status(502).json({ message: error.message });
  }
};


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

// Returns the latest iAccountId=0 (universal) base price for a focus product.
// Returns null when no matching record exists.
const getBasePriceFromFocus = (focusProductId, priceBookRecords) => {
  if (!focusProductId || !priceBookRecords || priceBookRecords.length === 0) return null;
  const currentDate = Math.floor(Date.now() / 1000 / 60 / 60 / 24);
  const records = priceBookRecords.filter(r =>
    Number(r.iProductId) === Number(focusProductId) &&
    Number(r.iAccountId) === 0 &&
    parseFocusDate(r.iStartDate) <= currentDate
  );
  if (!records.length) return null;
  records.sort((a, b) => parseFocusDate(b.iStartDate) - parseFocusDate(a.iStartDate));
  return Number(records[0].fVal1) || null;
};

// 3-step price resolution:
//   1. dealer-specific  (iAccountId === focusAccountId)
//   2. universal base   (iAccountId === 0)
//   3. stored catalog   (fallback when Focus8 unreachable)
const getEffectivePriceFromFocus = (focusProductId, focusAccountId, priceBookRecords, catalogPrice) => {
  if (!focusProductId || !priceBookRecords || priceBookRecords.length === 0) {
    return catalogPrice;
  }

  const currentDate = Math.floor(Date.now() / 1000 / 60 / 60 / 24);

  const findLatest = (accountId) => {
    const matching = priceBookRecords.filter(r =>
      Number(r.iProductId) === Number(focusProductId) &&
      Number(r.iAccountId) === Number(accountId) &&
      parseFocusDate(r.iStartDate) <= currentDate
    );
    if (!matching.length) return null;
    matching.sort((a, b) => parseFocusDate(b.iStartDate) - parseFocusDate(a.iStartDate));
    return Number(matching[0].fVal1) || null;
  };

  if (focusAccountId) {
    const dealerPrice = findLatest(focusAccountId);
    if (dealerPrice !== null) {
      logger.info(`FOCUS8 :: Dealer-specific price for product ${focusProductId}, account ${focusAccountId}: ${dealerPrice}`);
      return dealerPrice;
    }
  }

  const basePrice = findLatest(0);
  if (basePrice !== null) {
    logger.info(`FOCUS8 :: Base price (iAccountId=0) for product ${focusProductId}: ${basePrice}`);
    return basePrice;
  }

  return catalogPrice;
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

// Fetches the Focus8 pricebook, resolves iAccountId=0 base prices for every
// volume in product.focusProductMapping, persists them to price[] and
// rebuilds ProductPrice records for all dealers. Throws on Focus8 failure.
const seedPricesFromFocus = async (product) => {
  const mapping = product.focusProductMapping;
  if (!mapping || mapping.length === 0) {
    throw new Error('No focus product mapping defined — cannot seed prices from Focus8');
  }

  const priceBookRecords = await getPriceBookData();
  if (!priceBookRecords || priceBookRecords.length === 0) {
    throw new Error('Could not fetch price data from Focus8. Please try again.');
  }

  const parsedPrice = [];
  for (const entry of mapping) {
    const basePrice = getBasePriceFromFocus(entry.focusProductId, priceBookRecords);
    if (basePrice === null) {
      throw new Error(`No base price found in Focus8 for volume "${entry.volume}" (focus product ID ${entry.focusProductId})`);
    }
    parsedPrice.push({ volume: entry.volume, refId: 'All', price: basePrice });
  }

  await productOfferModel.updateOne(
    { _id: product._id },
    { $set: { price: parsedPrice } }
  );

  await processProductCatlogPrices(product._id, parsedPrice);

  logger.info(`FOCUS8 :: Seeded ${parsedPrice.length} prices for product ${product._id}`);
  return parsedPrice;
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

    let targetDealerId = req.body.dealerId || req.user._id.toString();
    const needsDealerPrices = accountType === 'Dealer' || (accountType === 'SalesExecutive' && req.body.dealerId);

    // For SE with dealerId: fetch the dealer upfront so we can use their productCategories
    // for the query filter and their dealerCode for Focus8 pricing (avoids a second DB round-trip).
    let prefetchedDealer = null;
    if (accountType === 'SalesExecutive' && req.body.dealerId) {
      try {
        prefetchedDealer = await UserModel.findById(req.body.dealerId).select('productCategories dealerCode');
      } catch (err) {
        logger.error('Error fetching dealer for SE catalog search', { dealerId: req.body.dealerId, error: err.message });
      }
    }

    // SuperUser sees all catalog items regardless of product category.
    // Dealers see only items whose productCategory matches one of their assigned categories.
    // SalesExecutives see only items whose productCategory matches one of their own assigned
    //   categories, or — when dealerId is provided — the dealer's assigned categories.
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
      const seCategoryFilter = prefetchedDealer
        ? { productCategory: { $in: prefetchedDealer.productCategories || [] } }
        : { productCategory: { $ne: null, $exists: true } };
      if (query['$or']) {
        query['$and'] = [{ $or: query['$or'] }, seCategoryFilter];
        delete query['$or'];
      } else {
        Object.assign(query, seCategoryFilter);
      }
    }

    // ── Run find + count in parallel ─────────────────────────────────────
    const [data, total] = await Promise.all([
      productOfferModel.find(query).populate('productCategory').skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 }),
      productOfferModel.countDocuments(query),
    ]);

    // ── Dealer info + Focus8 (cached) ────────────────────────────────────
    let dealerCode = null;
    let priceBookRecords = [];
    let focusAccountId = null;

    if (needsDealerPrices) {
      if (prefetchedDealer) {
        dealerCode = prefetchedDealer.dealerCode || null;
      } else {
        try {
          const dealerUser = await UserModel.findById(targetDealerId).select('dealerCode');
          dealerCode = dealerUser?.dealerCode || null;
        } catch (err) {
          logger.error('Error fetching dealer details', { targetDealerId, error: err.message });
        }
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
  try {
    const { focusProductId, focusUnitId, focusProductMapping, productCategory } = req.body;

    const duplicate = await productOfferModel.findOne({
      productOfferDescription: req.body.productDescription,
      _id: { $ne: req.params.id },
    });
    if (duplicate) {
      return res.status(400).json({ message: 'Product catalog with the same description already exists.' });
    }

    if (req.body.productImage) {
      if (req.body.productImageUrl) {
        const key = req.body.productImageUrl.split('/').pop();
        await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_PRODUCT_CATEGORY, Key: key }).promise();
      }
      const imageData = await decodeBase64Image(req.body.productImage);
      const s3Data = await s3.upload({
        Bucket: process.env.AWS_BUCKET_PRODUCT_CATEGORY,
        Key: `${req.params.id}.png`,
        Body: imageData.data,
        ContentType: imageData.type,
        ACL: 'public-read',
      }).promise();
      req.body.productImageUrl = s3Data.Location;
    }

    // Parse focusProductMapping if supplied; null means "don't re-seed prices"
    let parsedFocusMapping = null;
    if (focusProductMapping) {
      try {
        const mappingData = typeof focusProductMapping === 'string'
          ? JSON.parse(focusProductMapping)
          : focusProductMapping;

        if (!Array.isArray(mappingData) || mappingData.length === 0) {
          throw new Error('focusProductMapping must be a non-empty array');
        }

        parsedFocusMapping = mappingData.map(m => {
          if (!m.volume || !m.focusProductId) {
            throw new Error('Each mapping must have volume and focusProductId');
          }
          return {
            volume: m.volume,
            focusProductId: Number(m.focusProductId),
            focusUnitId: m.focusUnitId ? Number(m.focusUnitId) : 1,
          };
        });

        const volumeCounts = {};
        parsedFocusMapping.forEach(m => { volumeCounts[m.volume] = (volumeCounts[m.volume] || 0) + 1; });
        const duplicates = Object.keys(volumeCounts).filter(v => volumeCounts[v] > 1);
        if (duplicates.length > 0) {
          throw new Error(`Duplicate volumes in mapping: ${duplicates.join(', ')}`);
        }
      } catch (error) {
        return res.status(400).json({ message: 'Invalid focusProductMapping: ' + error.message });
      }
    }

    const updateData = {
      productOfferDescription: req.body.productDescription,
      productOfferStatus: req.body.productStatus,
      updatedBy: req.body.updatedBy,
      productCategory: productCategory || null,
      focusProductId: focusProductId ? Number(focusProductId) : null,
      focusUnitId: focusUnitId ? Number(focusUnitId) : null,
    };

    if (parsedFocusMapping !== null) {
      updateData.focusProductMapping = parsedFocusMapping;
    }

    if (req.body.productImageUrl) {
      updateData.productOfferImageUrl = req.body.productImageUrl;
    }

    // Capture old prices before update for rollback on seed failure
    const before = await productOfferModel.findById(req.params.id).select('price');
    const oldPrice = before?.price ?? [];

    const productCatlog = await productOfferModel.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!productCatlog) {
      return res.status(404).json({ message: 'Product catalog not found' });
    }

    if (parsedFocusMapping !== null) {
      try {
        await seedPricesFromFocus(productCatlog);
      } catch (seedErr) {
        // Restore old prices so the product stays consistent
        await productOfferModel.updateOne({ _id: req.params.id }, { $set: { price: oldPrice } }).catch(() => {});
        return res.status(502).json({ message: seedErr.message });
      }
    }

    return res.status(200).json({ data: productCatlog });
  } catch (error) {
    console.log(error);
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 4 MB!' });
    }
    return res.status(500).json({ message: error.message });
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

// Sync prices for a single product from Focus8 pricebook
exports.syncProductPrices = async (req, res) => {
  try {
    const product = await productOfferModel.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const seeded = await seedPricesFromFocus(product);
    return res.status(200).json({ success: true, pricesSynced: seeded.length });
  } catch (error) {
    logger.error('Error syncing product prices', { id: req.params.id, error: error.message });
    return res.status(502).json({ message: error.message });
  }
};

// Sync prices for all products that have a focusProductMapping
exports.syncAllProductPrices = async (req, res) => {
  try {
    const products = await productOfferModel.find({
      'focusProductMapping.0': { $exists: true },
    });

    let synced = 0;
    let skipped = 0;
    const errors = [];

    for (const product of products) {
      try {
        await seedPricesFromFocus(product);
        synced++;
      } catch (err) {
        skipped++;
        errors.push(`${product.productOfferDescription}: ${err.message}`);
        logger.warn('FOCUS8 :: Skipped product during sync-all', {
          productId: product._id,
          error: err.message,
        });
      }
    }

    return res.status(200).json({ success: true, synced, skipped, errors });
  } catch (error) {
    logger.error('Error in syncAllProductPrices', { error: error.message });
    return res.status(500).json({ message: error.message });
  }
};
