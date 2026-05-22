const productOffersModel = require('../models/productOffers.model');
const AWS = require('aws-sdk');
const { decodeBase64Image } = require('../services/utils.service');
const s3 = require("../config/aws");
const multer = require("multer");
const logger = require('../utils/logger');
const UserModel = require('../models/User');
const ProductPriceModel = require('../models/ProductPrice');
const sharp = require('sharp');

async function generateThumbnail(imageBuffer) {
    return sharp(imageBuffer)
        .resize({ width: 300, withoutEnlargement: true })
        .png()
        .toBuffer();
}


// Create a new productOffer
exports.createProductOffer = async (req, res) => {
    let {productOfferDescription, validUntil, productOfferStatus, cashback, redeemPoints, price} = req.body;
    const productCategory = req.body.productCategory || null;
    const offerType = req.body.offerType || 'ongoing';
    if (!req.body.productOfferImage) {
        return res.status(400).json({message: 'Image is required'});
    }
    const imageData = await decodeBase64Image(req.body.productOfferImage);

    if (imageData instanceof Error) {
        return res.status(400).json({ message: 'Invalid image data' });
    }

  
    let parsedPrice;
    try {
        parsedPrice = typeof price === 'string' ? JSON.parse(price) : price;
        if (!Array.isArray(parsedPrice)) throw new Error();
        
        // Transform the price array to match the required schema
        parsedPrice = parsedPrice.map(priceObj => {
            const [[refId, price]] = Object.entries(priceObj);
            return {
                refId: refId,
                price: price
            };
        });

    } catch {
        return res.status(400).json({ message: 'Invalid price format' });
    }



    const productOffer = new productOffersModel({
        productOfferDescription,
        validUntil,
        productOfferStatus,
        cashback,
        redeemPoints,
        price : parsedPrice,
        productCategory,
        offerType,
    });

    try {
        // Check if the productOfferDescription already exists
        const existingProductOffer = await productOffersModel.findOne({productOfferDescription});
        if (existingProductOffer) {
            return res.status(400).json({message: 'Product offer text with  same title already exists.'});
        }
        let savedProductOffer = await productOffer.save();
        const savedProductOfferId = savedProductOffer._id;

        /*const s3 = new AWS.S3({
            region: process.env.AWS_REGION,
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        });*/

        const params = {
            Bucket: process.env.AWS_BUCKET_PRODUCT_OFFER,
            Key: `${savedProductOffer._id}.png`,
            Body: imageData.data,
            ContentType: imageData.type,
            ACL: 'public-read'
        };

        const data = await s3.upload(params).promise();

        const thumbnailBuffer = await generateThumbnail(imageData.data);
        const thumbParams = {
            Bucket: process.env.AWS_BUCKET_PRODUCT_OFFER,
            Key: `${savedProductOffer._id}_thumbnail.png`,
            Body: thumbnailBuffer,
            ContentType: 'image/png',
            ACL: 'public-read'
        };
        const thumbData = await s3.upload(thumbParams).promise();

        savedProductOffer = await productOffersModel.updateOne(
            { _id: savedProductOffer._id },
            { $set: { productOfferImageUrl: data.Location, productOfferThumbnailUrl: thumbData.Location } }
        );

        await processProductPrices(savedProductOfferId, parsedPrice);

        return res.status(201).json(savedProductOffer);
    } catch (error) {
        console.log(error, '==============================');
        if (error instanceof multer.MulterError) {
            // Handle Multer-specific errors
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File size exceeds 4 MB!' });
            }
        } else {
            return res.status(500).json({message: error.message});
        }
    }
};

const processProductPrices = async (productOfferId, parsedPrice) => {
    try {
        await ProductPriceModel.deleteMany({productOfferId: productOfferId});
        const dealers = await UserModel.find({ accountType: 'Dealer'});
        const productPrices = dealers.map(dealer => {
            let priceObj = parsedPrice.find(p => p.refId === dealer.district) ||
                parsedPrice.find(p => p.refId === dealer.zone) ||
                parsedPrice.find(p => p.refId === dealer.state) ||
                parsedPrice.find(p => p.refId === 'All');

            return priceObj ? {
                dealerId: dealer._id,
                productOfferId,
                price: priceObj.price   
            } : null;
        }).filter(entry => entry !== null);  // Remove null values

        if (productPrices.length > 0) {
            await ProductPriceModel.insertMany(productPrices);
        }
        logger.info("Dealer prices updated successfully.");
    } catch (error) {
        console.error('error while processing dealer prices --- ', error);
        logger.error('error while processing dealer prices', {
            error: error.message,
            errorObj: JSON.stringify(error)
        });
    }
}

/*exports.processProductPrices = async (req, res) => {
    try {
        let productOfferId = req.body.productOfferId;
        let prices = req.body.prices;
        await ProductPriceModel.deleteMany({productOfferId: productOfferId});
        const dealers = await UserModel.find({ accountType: 'Dealer'});
        const productPrices = dealers.map(dealer => {
            let priceObj = prices.find(p => p.refId === dealer.district) ||
                prices.find(p => p.refId === dealer.zone) ||
                prices.find(p => p.refId === dealer.state) ||
                prices.find(p => p.refId === 'ALL');

            return priceObj ? {
                dealerId: dealer._id,
                productOfferId,
                price: priceObj.price
            } : null;
        }).filter(entry => entry !== null);  // Remove null values

        if (productPrices.length > 0) {
            await ProductPriceModel.insertMany(productPrices);
        }
        logger.info("Dealer prices updated successfully.");
        return res.status(200).json("Dealer prices updated successfully.");
    } catch (error) {
        console.error('error while processing dealer prices --- ', error);
        logger.error('error while processing dealer prices', {
            error: error.message,
            errorObj: JSON.stringify(error)
        });
        return res.status(400).json(error.message);
    }
};*/

// Get all productOffers
exports.getProductOffers = async (req, res) => {
    try {
        let page = req.body.page || 1;
        let limit = req.body.limit || 10;
        const productOffers = await productOffersModel.find({productOfferStatus: 'Active'})
            .skip((page - 1) * limit)
            .limit(limit)
            .sort({createdAt: -1});
        res.status(200).json(productOffers);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
}

exports.searchProductOffers = async (req, res) => {
    try {
        let page = parseInt(req.body.page || 1);
        let limit = parseInt(req.body.limit || 10);
        let dealerId = req.user._id.toString();
        let query = { offerAvailable: true };
        if (req.body.searchQuery) {
            query['$or'] = [
                // {'productOfferTitle': {$regex: new RegExp(req.body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
                {'productOfferDescription': {$regex: new RegExp(req.body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
            ];
        }

        let data = await productOffersModel.find(query).skip((page - 1) * limit).limit(parseInt(limit)).sort({createdAt: -1});
        const totalOffers = await productOffersModel.countDocuments(query);
        const updatedData = await Promise.all(data.map(async (productOffer) => {
            let dealerIds = []
            if (req.user.accountType === 'SalesExecutive') {
                let users = await UserModel.find({salesExecutive: req.user.mobile, accountType: 'Dealer'});
                let dealersIdsSet = users.map(user => user._id.toString());
                dealersIdsSet.push(dealerId) 
                dealerIds = {$in: dealersIdsSet};
            } else {
                let dealersIdsSet = [dealerId];
                dealerIds = {$in: dealersIdsSet};
            }
            const priceData = await ProductPriceModel.findOne({
                productOfferId: productOffer._id,
                dealerId: dealerIds
            })
            return {
                ...productOffer._doc,
                // Use the mongoose model accessor (.offerType, not ._doc.offerType) so
                // the schema default 'ongoing' is applied for documents that pre-date
                // this field and don't have it stored in MongoDB.
                offerType: productOffer.offerType || 'ongoing',
                productPrice: priceData ? priceData.price : null,
            };
        }))

        return res.status(200).json({
            data: updatedData,
            total: totalOffers,
            pages: Math.ceil(totalOffers / limit),
            currentPage: page
        });
    } catch (err) {
        return res.status(500).json({message: "Something went wrong"});
    }
}

// Get a productOffer by ID
exports.getProductOfferById = async (req, res) => {
    try {
        const productOffer = await productOffersModel.findById(req.params.id);
        if (!productOffer) {
            return res.status(404).json({message: 'ProductOffer not found'});
        }
        res.status(200).json(productOffer);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
}

// Update a productOffer by ID
exports.updateProductOffer = async (req, res) => {
    try {
        const existingProductOffer = await productOffersModel.findOne({productOfferDescription: req.body.productOfferDescription, _id: {$ne: req.params.id}});
        if (existingProductOffer) {
            return res({status: 400, message: 'Product offer text with  same title already exists.'});
        }
        /*const s3 = new AWS.S3({
            region: process.env.AWS_REGION,
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        });*/
        if (req.body.productOfferImage) {
            if (req.body.productOfferImageUrl) {
                const imgKey = req.body.productOfferImageUrl.split('/').pop();
                await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_PRODUCT_OFFER, Key: imgKey }).promise();
            }
            if (req.body.productOfferThumbnailUrl) {
                const thumbKey = req.body.productOfferThumbnailUrl.split('/').pop();
                await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_PRODUCT_OFFER, Key: thumbKey }).promise();
            }


            

            const imageData = await decodeBase64Image(req.body.productOfferImage);
            const params = {
                Bucket: process.env.AWS_BUCKET_PRODUCT_OFFER,
                Key: `${req.params.id}.png`,
                Body: imageData.data,
                ContentType: imageData.type,
                ACL: 'public-read'
            };
            const data = await s3.upload(params).promise();
            req.body.productOfferImageUrl = data.Location;

            const thumbnailBuffer = await generateThumbnail(imageData.data);
            const thumbParams = {
                Bucket: process.env.AWS_BUCKET_PRODUCT_OFFER,
                Key: `${req.params.id}_thumbnail.png`,
                Body: thumbnailBuffer,
                ContentType: 'image/png',
                ACL: 'public-read'
            };
            const thumbData = await s3.upload(thumbParams).promise();
            req.body.productOfferThumbnailUrl = thumbData.Location;
        }


         let parsedPrice;
        try {
            const { price } = req.body;
            parsedPrice = typeof price === 'string' ? JSON.parse(price) : price;
            
            if (!Array.isArray(parsedPrice)) {
                return res.status(400).json({ message: 'Price must be an array' });
            }

            parsedPrice = parsedPrice.map(priceObj => {
                try {
                    const [[refId, price]] = Object.entries(priceObj);
                    return { refId, price };
                } catch (e) {
                    throw new Error('Invalid price object structure');
                }
            });
        } catch (priceError) {
            console.error('Price parsing error:', priceError);
            return res.status(400).json({ message: 'Invalid price format' });
        }

        const productOfferData = {
            productOfferDescription: req.body.productOfferDescription,
            // productOfferTitle: req.body.productOfferTitle,
            validUntil: req.body.validUntil,
            productOfferStatus: req.body.productOfferStatus,
            cashback: req.body.cashback,
            redeemPoints: req.body.redeemPoints,
            productOfferImageUrl: req.body.productOfferImageUrl,
            updatedBy: req.body.updatedBy,
            price: parsedPrice,
            productCategory: req.body.productCategory || null,
            productOfferThumbnailUrl: req.body.productOfferThumbnailUrl,
            offerType: req.body.offerType || 'ongoing',
        };

        const productOffer = await productOffersModel.findByIdAndUpdate(req.params.id,  productOfferData, {new: true});
        if (!productOffer) {
            return res({status: 400, message: 'ProductOffer not found'});
        }

        await processProductPrices(req.params.id, parsedPrice);
        
        return res({status: 200, data: productOffer});
    } catch (error) {
        console.log(error);
        if (error instanceof multer.MulterError) {
            // Handle Multer-specific errors
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File size exceeds 4 MB!' });
            }
        } else {
            return res({status: 500, message: error.message});
        }
    }
}

// Delete a productOffer by ID
exports.deleteProductOffer = async (req, res) => {
    try {
        const productOffer = await productOffersModel.findByIdAndDelete(req.params.id);
        if (!productOffer) {
            return res.status(404).json({message: 'ProductOffer not found'});
        }
        res.status(200).json({message: 'ProductOffer deleted successfully'});
    } catch (error) {
        res.status(500).json({message: error.message});
    }
}
